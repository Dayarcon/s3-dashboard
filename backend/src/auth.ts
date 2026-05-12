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
  getWorkspaceByDomain,
  setWorkspaceDomain,
  getWorkspaceAdmins,
  getInviteByCode,
  markInviteAsUsed,
  createJoinRequest,
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
  email: string;
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
  email: z.string().email(),
  password: z.string().min(1).max(512),
  workspaceId: z.number().optional(),
});

router.post(
  '/login',
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password, workspaceId } = req.body as z.infer<typeof loginSchema>;
    const ipKey = `ip:${req.ip}`;
    const emailKey = `email:${email.toLowerCase()}`;

    // Pre-check lockout on either key
    for (const key of [emailKey, ipKey]) {
      const { locked, retryAfterMs } = isLocked(key);
      if (locked) {
        if (retryAfterMs) {
          res.setHeader('Retry-After', Math.ceil(retryAfterMs / 1000).toString());
        }
        throw new AppError('account_locked', 429, 'Too many failed attempts. Try again later.');
      }
    }

    // Find all users with this email
    const result = await pool.query(
      'SELECT id, username, email, password_hash, role, is_active, must_change_password, workspace_id FROM users WHERE email = $1 ORDER BY workspace_id',
      [email]
    );
    const users = (result.rows as User[]);

    // If no users found, reject
    if (users.length === 0) {
      recordFailure(emailKey);
      recordFailure(ipKey);
      throw new AppError('invalid_credentials', 401, 'Invalid credentials.');
    }

    // If workspaceId not provided but multiple workspaces exist, return workspace list
    if (!workspaceId && users.length > 1) {
      const workspaces = await Promise.all(
        users.map(async (u) => {
          const wsResult = await pool.query('SELECT id, name FROM workspaces WHERE id = $1', [u.workspace_id]);
          return { workspaceId: u.workspace_id, workspaceName: wsResult.rows[0]?.name || 'Unknown' };
        })
      );
      return res.status(200).json({
        requiresSelection: true,
        workspaces,
        message: 'Please select a workspace to continue.',
      });
    }

    // Get the user to login (either the one specified by workspaceId or the only one)
    const targetUser = workspaceId
      ? users.find((u) => u.workspace_id === workspaceId)
      : users[0];

    if (!targetUser) {
      recordFailure(emailKey);
      recordFailure(ipKey);
      throw new AppError('invalid_credentials', 401, 'Invalid credentials.');
    }

    // Validate password
    const valid = targetUser.is_active && (await bcrypt.compare(password, targetUser.password_hash));

    if (!valid) {
      const lockedUser = recordFailure(emailKey);
      const lockedIp = recordFailure(ipKey);
      try {
        await insertAudit(targetUser.workspace_id, targetUser.id, 'login_failed', 'auth', {
          email,
          ip: req.ip,
          locked: lockedUser || lockedIp,
        });
      } catch (e) {
        logger.warn({ err: e }, 'failed_to_audit_login_failure');
      }
      throw new AppError('invalid_credentials', 401, 'Invalid credentials.');
    }

    recordSuccess(emailKey);
    recordSuccess(ipKey);

    const token = jwt.sign(
      {
        sub: targetUser.id,
        username: targetUser.email,
        role: targetUser.role,
        workspaceId: targetUser.workspace_id,
      },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn } as jwt.SignOptions
    );

    await insertAudit(targetUser.workspace_id, targetUser.id, 'login', 'auth', { ip: req.ip, email });
    res.json({
      token,
      user: {
        id: targetUser.id,
        email: targetUser.email,
        username: targetUser.username,
        role: targetUser.role,
        workspaceId: targetUser.workspace_id,
        must_change_password: !!targetUser.must_change_password,
      },
    });
  })
);

// ---- WORKSPACE SIGNUP ----
const signupSchema = z.object({
  workspaceName: z.string().min(1).max(255),
  username: z.string().min(1).max(128),
  email: z.string().email(),
  password: z.string().min(1).max(512),
});

router.post(
  '/signup',
  validate(signupSchema),
  asyncHandler(async (req, res) => {
    const { workspaceName, username, email, password } = req.body as z.infer<typeof signupSchema>;
    assertPasswordPolicy(password);

    // Extract domain from email
    const emailDomain = email.split('@')[1];

    // Check if workspace already exists for this domain
    const existingWorkspace = await getWorkspaceByDomain(emailDomain);
    if (existingWorkspace) {
      // Workspace found for this domain - return discovery response
      const admins = await getWorkspaceAdmins(existingWorkspace.id);
      return res.status(200).json({
        workspaceFound: true,
        workspace: {
          id: existingWorkspace.id,
          name: existingWorkspace.name,
          admins: admins.map((a) => ({ id: a.id, email: a.email, username: a.username })),
        },
        message: `A workspace "${existingWorkspace.name}" already exists for your organization. Contact an admin to request access.`,
      });
    }

    // Generate unique slug
    const slug = slugify(workspaceName);

    // Create workspace and first user in a transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Create workspace with domain
      const wsResult = await client.query(
        'INSERT INTO workspaces (name, slug, organization_domain) VALUES ($1, $2, $3) RETURNING id',
        [workspaceName, slug, emailDomain]
      );
      const workspaceId = wsResult.rows[0].id;

      // Check if username already exists in this workspace (shouldn't, but be safe)
      const existingUsername = await client.query(
        'SELECT id FROM users WHERE workspace_id = $1 AND username = $2',
        [workspaceId, username]
      );
      if (existingUsername.rows.length > 0) {
        throw new AppError('user_exists', 409, 'Username already exists in this workspace.');
      }

      // Check if email already exists in this workspace
      const existingEmail = await client.query(
        'SELECT id FROM users WHERE workspace_id = $1 AND email = $2',
        [workspaceId, email]
      );
      if (existingEmail.rows.length > 0) {
        throw new AppError('email_exists', 409, 'Email already exists in this workspace.');
      }

      // Create admin user
      const hash = await bcrypt.hash(password, config.auth.bcryptRounds);
      const userResult = await client.query(
        'INSERT INTO users (workspace_id, username, email, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [workspaceId, username, email, hash, 'admin']
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
          username: email,
          email,
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
          email,
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
  email: z.string().email(),
  username: z.string().min(1).max(128),
  password: z.string().min(1).max(512),
});

router.post(
  '/join',
  validate(joinSchema),
  asyncHandler(async (req, res) => {
    const { code, email, username, password } = req.body as z.infer<typeof joinSchema>;
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

      // Check email doesn't exist in this workspace
      const existingEmail = await client.query(
        'SELECT id FROM users WHERE workspace_id = $1 AND email = $2',
        [workspaceId, email]
      );
      if (existingEmail.rows.length > 0) {
        throw new AppError('email_exists', 409, 'Email already exists in this workspace.');
      }

      // Create user
      const hash = await bcrypt.hash(password, config.auth.bcryptRounds);
      const userResult = await client.query(
        'INSERT INTO users (workspace_id, username, email, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [workspaceId, username, email, hash, invite.role]
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
        [workspaceId, userId, 'invite_accepted', 'auth', JSON.stringify({ code, email })]
      );

      await client.query('COMMIT');

      const token = jwt.sign(
        {
          sub: userId,
          username: email,
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
          email,
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
