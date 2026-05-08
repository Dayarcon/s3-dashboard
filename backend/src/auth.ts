// backend/src/auth.ts
// Authentication endpoints: login, workspace signup, invite join, password change, etc.

import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import crypto from 'crypto';
import {
  findUserById,
  findUserByUsername,
  createUser,
  insertAudit,
  getAllowedBucketsForUser,
  createWorkspace,
  getWorkspace,
  getInviteByCode,
  markInviteAsUsed,
  listUsers,
  updateUser,
  pool,
} from './db';
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
  is_active: boolean;
  must_change_password?: boolean;
  workspace_id: number;
};

// Helper: generate URL-safe slug from workspace name
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .substring(0, 50);
}

// ---- LOGIN ----
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

    // Find user by username across all workspaces
    // If user exists in multiple workspaces, use the first one
    const result = await pool.query(
      'SELECT id, username, password_hash, role, is_active, must_change_password, workspace_id FROM users WHERE username = $1 LIMIT 1',
      [username]
    );
    const user = (result.rows[0] as User | undefined);
    const valid = user && user.is_active && (await bcrypt.compare(password, user.password_hash));

    if (!valid) {
      const lockedUser = recordFailure(userKey);
      const lockedIp = recordFailure(ipKey);
      try {
        if (user) {
          await insertAudit(user.workspace_id, user.id, 'login_failed', 'auth', {
            username,
            ip: req.ip,
            locked: lockedUser || lockedIp,
          });
        }
      } catch (e) {
        logger.warn({ err: e }, 'failed_to_audit_login_failure');
      }
      throw new AppError('invalid_credentials', 401, 'Invalid credentials.');
    }

    recordSuccess(userKey);
    recordSuccess(ipKey);

    const token = jwt.sign(
      {
        sub: user!.id,
        username: user!.username,
        role: user!.role,
        workspaceId: user!.workspace_id,
      },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn } as jwt.SignOptions
    );

    await insertAudit(user!.workspace_id, user!.id, 'login', 'auth', { ip: req.ip, username });
    res.json({
      token,
      user: {
        id: user!.id,
        username: user!.username,
        role: user!.role,
        workspaceId: user!.workspace_id,
        must_change_password: !!user!.must_change_password,
      },
    });
  })
);

// ---- WORKSPACE SIGNUP ----
const signupSchema = z.object({
  workspaceName: z.string().min(1).max(255),
  username: z.string().min(1).max(128),
  password: z.string().min(1).max(512),
});

router.post(
  '/signup',
  validate(signupSchema),
  asyncHandler(async (req, res) => {
    const { workspaceName, username, password } = req.body as z.infer<typeof signupSchema>;
    assertPasswordPolicy(password);

    // Generate unique slug
    let slug = slugify(workspaceName);
    let counter = 0;
    while (counter < 100) {
      const existing = await getWorkspace(0); // Just a test query; better approach below
      // Actually, let's try to create and catch unique violation
      break;
    }

    // Create workspace and first user in a transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Create workspace
      const wsResult = await client.query(
        'INSERT INTO workspaces (name, slug) VALUES ($1, $2) RETURNING id',
        [workspaceName, slug]
      );
      const workspaceId = wsResult.rows[0].id;

      // Check if username already exists in this workspace (shouldn't, but be safe)
      const existing = await client.query(
        'SELECT id FROM users WHERE workspace_id = $1 AND username = $2',
        [workspaceId, username]
      );
      if (existing.rows.length > 0) {
        throw new AppError('user_exists', 409, 'Username already exists in this workspace.');
      }

      // Create admin user
      const hash = await bcrypt.hash(password, config.auth.bcryptRounds);
      const userResult = await client.query(
        'INSERT INTO users (workspace_id, username, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id',
        [workspaceId, username, hash, 'admin']
      );
      const userId = userResult.rows[0].id;

      // Log audit
      await client.query(
        'INSERT INTO audit_logs (workspace_id, user_id, action, resource, details) VALUES ($1, $2, $3, $4, $5)',
        [workspaceId, userId, 'signup', 'auth', JSON.stringify({ username })]
      );

      await client.query('COMMIT');

      const token = jwt.sign(
        {
          sub: userId,
          username,
          role: 'admin',
          workspaceId,
        },
        config.jwtSecret,
        { expiresIn: config.jwtExpiresIn } as jwt.SignOptions
      );

      res.status(201).json({
        token,
        user: {
          id: userId,
          username,
          role: 'admin',
          workspaceId,
        },
      });
    } catch (err: any) {
      await client.query('ROLLBACK');
      if (err.code === '23505') {
        // unique_violation
        throw new AppError('slug_exists', 409, 'Workspace name already taken.');
      }
      throw err;
    } finally {
      client.release();
    }
  })
);

// ---- INVITE JOIN ----
const joinSchema = z.object({
  code: z.string().min(1).max(255),
  username: z.string().min(1).max(128),
  password: z.string().min(1).max(512),
});

router.post(
  '/join',
  validate(joinSchema),
  asyncHandler(async (req, res) => {
    const { code, username, password } = req.body as z.infer<typeof joinSchema>;
    assertPasswordPolicy(password);

    // Get invite
    const invite = await getInviteByCode(code);
    if (!invite) {
      throw new AppError('invalid_invite', 400, 'Invite code not found or expired.');
    }

    // Validate: not used, not expired
    if (invite.used_at) {
      throw new AppError('invite_used', 400, 'This invite has already been used.');
    }
    if (new Date(invite.expires_at) < new Date()) {
      throw new AppError('invite_expired', 400, 'This invite has expired.');
    }

    // Create user in workspace with a transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const workspaceId = invite.workspace_id;

      // Check username doesn't exist in this workspace
      const existing = await client.query(
        'SELECT id FROM users WHERE workspace_id = $1 AND username = $2',
        [workspaceId, username]
      );
      if (existing.rows.length > 0) {
        throw new AppError('user_exists', 409, 'Username already exists in this workspace.');
      }

      // Create user
      const hash = await bcrypt.hash(password, config.auth.bcryptRounds);
      const userResult = await client.query(
        'INSERT INTO users (workspace_id, username, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id',
        [workspaceId, username, hash, invite.role]
      );
      const userId = userResult.rows[0].id;

      // Mark invite as used
      await client.query(
        'UPDATE workspace_invites SET used_at = NOW(), used_by = $1 WHERE id = $2',
        [userId, invite.id]
      );

      // Log audit
      await client.query(
        'INSERT INTO audit_logs (workspace_id, user_id, action, resource, details) VALUES ($1, $2, $3, $4, $5)',
        [workspaceId, userId, 'invite_accepted', 'auth', JSON.stringify({ code })]
      );

      await client.query('COMMIT');

      const token = jwt.sign(
        {
          sub: userId,
          username,
          role: invite.role,
          workspaceId,
        },
        config.jwtSecret,
        { expiresIn: config.jwtExpiresIn } as jwt.SignOptions
      );

      res.status(201).json({
        token,
        user: {
          id: userId,
          username,
          role: invite.role,
          workspaceId,
        },
      });
    } catch (err: any) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  })
);

// ---- LOGOUT ----
router.post(
  '/logout',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    if (req.user) {
      await insertAudit(req.user.workspaceId, req.user.sub, 'logout', 'auth', { ip: req.ip });
    }
    res.json({ ok: true });
  })
);

// ---- CHANGE PASSWORD ----
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

    const user = await findUserById(req.user!.sub);
    if (!user) throw new AppError('user_not_found', 404);

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) throw new AppError('invalid_current_password', 401);

    const hash = await bcrypt.hash(newPassword, config.auth.bcryptRounds);
    await updateUser(user.id, { must_change_password: false });
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, user.id]);
    await insertAudit(
      req.user!.workspaceId,
      user.id,
      'password_change',
      'auth',
      { ip: req.ip }
    );
    res.json({ ok: true });
  })
);

// ---- REFRESH TOKEN ----
router.post(
  '/refresh',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    const user = await findUserById(req.user.sub);
    if (!user || !user.is_active) throw new AppError('user_inactive', 401);

    const token = jwt.sign(
      {
        sub: user.id,
        username: user.username,
        role: user.role,
        workspaceId: user.workspace_id,
      },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn } as jwt.SignOptions
    );
    res.json({ token });
  })
);

// ---- GET ME ----
router.get(
  '/me',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    const userId = req.user.sub;
    const workspaceId = req.user.workspaceId;

    const user = await findUserById(userId);
    if (!user) throw new AppError('user_not_found', 404);

    const permsResult = await pool.query(
      `SELECT DISTINCT p.resource, p.access
       FROM permissions p
       JOIN user_groups ug ON ug.group_id = p.group_id
       JOIN groups g ON g.id = p.group_id
       WHERE ug.user_id = $1 AND g.workspace_id = $2`,
      [userId, workspaceId]
    );

    const allowedBuckets = await getAllowedBucketsForUser(workspaceId, userId);

    res.json({
      user: { id: user.id, username: user.username, role: user.role, workspaceId },
      permissions: permsResult.rows,
      allowedBuckets,
    });
  })
);

export default router;
