// backend/src/auth.ts
import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { findUserByUsername, createUser, insertAudit, db, getAllowedBucketsForUser } from './db';
import { authMiddleware, AuthRequest } from './middleware/authMiddleware';
import { config } from './config';
import { AppError, asyncHandler } from './errors';
import { validate } from './validate';
import { assertPasswordPolicy } from './passwordPolicy';
import { isLocked, recordFailure, recordSuccess } from './loginLockout';
import { logger } from './logger';

const router = express.Router();

type User = {
  id: number;
  username: string;
  password_hash: string;
  role: string;
  is_active: number;
  must_change_password?: number;
};

const loginSchema = z.object({
  username: z.string().min(1).max(128),
  password: z.string().min(1).max(512),
});

router.post(
  '/login',
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { username, password } = req.body as z.infer<typeof loginSchema>;
    const ipKey = `ip:${req.ip}`;
    const userKey = `user:${username.toLowerCase()}`;

    // Pre-check lockout on either key.
    for (const key of [userKey, ipKey]) {
      const { locked, retryAfterMs } = isLocked(key);
      if (locked) {
        if (retryAfterMs) {
          res.setHeader('Retry-After', Math.ceil(retryAfterMs / 1000).toString());
        }
        throw new AppError('account_locked', 429, 'Too many failed attempts. Try again later.');
      }
    }

    const user = findUserByUsername(username) as User | undefined;
    const valid = user && user.is_active && (await bcrypt.compare(password, user.password_hash));

    if (!valid) {
      const lockedUser = recordFailure(userKey);
      const lockedIp = recordFailure(ipKey);
      try {
        insertAudit(user?.id ?? null, 'login_failed', 'auth', {
          username,
          ip: req.ip,
          locked: lockedUser || lockedIp,
        });
      } catch (e) {
        logger.warn({ err: e }, 'failed_to_audit_login_failure');
      }
      throw new AppError('invalid_credentials', 401, 'Invalid credentials.');
    }

    recordSuccess(userKey);
    recordSuccess(ipKey);

    const token = jwt.sign(
      { sub: user!.id, username: user!.username, role: user!.role },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn } as jwt.SignOptions
    );

    insertAudit(user!.id, 'login', 'auth', { ip: req.ip, username });
    res.json({
      token,
      user: {
        id: user!.id,
        username: user!.username,
        role: user!.role,
        must_change_password: !!user!.must_change_password,
      },
    });
  })
);

const signupSchema = z.object({
  username: z.string().min(1).max(128),
  password: z.string().min(1).max(512),
  role: z.string().max(64).optional(),
});

// Public signup: disabled by default. When enabled (PUBLIC_SIGNUP_ENABLED=true) it
// is still safer than the original since password policy + validation are enforced.
router.post(
  '/signup',
  validate(signupSchema),
  asyncHandler(async (req, res) => {
    if (!config.auth.publicSignupEnabled) {
      throw new AppError('signup_disabled', 403, 'Public signup is disabled.');
    }
    const { username, password, role } = req.body as z.infer<typeof signupSchema>;
    assertPasswordPolicy(password);

    if (findUserByUsername(username)) {
      throw new AppError('user_exists', 409, 'A user with that username already exists.');
    }
    const hash = await bcrypt.hash(password, config.auth.bcryptRounds);
    const id = createUser(username, hash, role || 'developer');
    insertAudit(id as number, 'signup', 'auth', { username, role });
    res.json({ id, username, role: role || 'developer' });
  })
);

router.post(
  '/logout',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    if (req.user) {
      insertAudit(req.user.sub, 'logout', 'auth', { ip: req.ip });
    }
    res.json({ ok: true });
  })
);

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(512),
  newPassword: z.string().min(1).max(512),
});

router.post(
  '/change-password',
  authMiddleware,
  validate(changePasswordSchema),
  asyncHandler(async (req: AuthRequest, res) => {
    const { currentPassword, newPassword } = req.body as z.infer<typeof changePasswordSchema>;
    assertPasswordPolicy(newPassword);

    const user = findUserByUsername(req.user!.username) as User | undefined;
    if (!user) throw new AppError('user_not_found', 404);

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) throw new AppError('invalid_current_password', 401);

    const hash = await bcrypt.hash(newPassword, config.auth.bcryptRounds);
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(
      hash,
      user.id
    );
    insertAudit(user.id, 'password_change', 'auth', { ip: req.ip });
    res.json({ ok: true });
  })
);

router.post(
  '/refresh',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    const user = findUserByUsername(req.user.username) as User | undefined;
    if (!user || !user.is_active) throw new AppError('user_inactive', 401);

    const token = jwt.sign(
      { sub: user.id, username: user.username, role: user.role },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn } as jwt.SignOptions
    );
    res.json({ token });
  })
);

router.get(
  '/me',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    const userId = req.user.sub;
    const user = db
      .prepare('SELECT id, username, role, is_active FROM users WHERE id = ?')
      .get(userId) as any;
    if (!user) throw new AppError('user_not_found', 404);

    const perms = db
      .prepare(
        `SELECT DISTINCT p.resource, p.access
         FROM permissions p
         JOIN user_groups ug ON ug.group_id = p.group_id
         WHERE ug.user_id = ?`
      )
      .all(userId) as Array<{ resource: string; access: string }>;

    const allowedBuckets = getAllowedBucketsForUser(userId);

    res.json({
      user: { id: user.id, username: user.username, role: user.role },
      permissions: perms,
      allowedBuckets,
    });
  })
);

export default router;
