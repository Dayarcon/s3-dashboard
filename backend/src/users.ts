import express from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { createUser, insertAudit, pool } from './db';
import { authMiddleware, AuthRequest } from './middleware/authMiddleware';
import { config } from './config';
import { AppError, asyncHandler } from './errors';
import { validate } from './validate';
import { assertPasswordPolicy } from './passwordPolicy';

const router = express.Router();

function requireAdmin(req: AuthRequest) {
  if (req.user?.role !== 'admin') throw new AppError('admin_only', 403);
}

router.get(
  '/',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    requireAdmin(req);

    const result = await pool.query(
      `SELECT u.id, u.username, u.role, u.is_active, u.created_at,
              g.id as group_id, g.name as group_name
       FROM users u
       LEFT JOIN user_groups ug ON ug.user_id = u.id
       LEFT JOIN groups g ON g.id = ug.group_id
       WHERE u.workspace_id = $1
       ORDER BY u.created_at DESC`,
      [req.user.workspaceId]
    );

    const usersMap: Record<number, any> = {};
    for (const row of result.rows) {
      if (!usersMap[row.id]) {
        usersMap[row.id] = {
          id: row.id,
          username: row.username,
          role: row.role,
          is_active: row.is_active,
          created_at: row.created_at,
          groups: [],
        };
      }
      if (row.group_id) {
        usersMap[row.id].groups.push({ id: row.group_id, name: row.group_name });
      }
    }

    await insertAudit(req.user.workspaceId, req.user.sub, 'list_users', 'users', {});
    res.json(Object.values(usersMap));
  })
);

const userIdParam = z.object({ userId: z.coerce.number().int().positive() });

router.get(
  '/:userId',
  authMiddleware,
  validate(userIdParam, 'params'),
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    requireAdmin(req);
    const userId = (req.params as any).userId as number;

    const userResult = await pool.query(
      'SELECT id, username, role, is_active, created_at FROM users WHERE id = $1 AND workspace_id = $2',
      [userId, req.user.workspaceId]
    );
    if (userResult.rows.length === 0) throw new AppError('user_not_found', 404);
    const user = userResult.rows[0];

    const groupsResult = await pool.query(
      `SELECT g.id, g.name, g.created_at
       FROM groups g
       INNER JOIN user_groups ug ON g.id = ug.group_id
       WHERE ug.user_id = $1 AND g.workspace_id = $2`,
      [userId, req.user.workspaceId]
    );

    const groupsWithPermissions = await Promise.all(
      groupsResult.rows.map(async (group) => {
        const permResult = await pool.query(
          'SELECT id, resource, access FROM permissions WHERE group_id = $1',
          [group.id]
        );
        return { ...group, permissions: permResult.rows };
      })
    );

    await insertAudit(req.user.workspaceId, req.user.sub, 'view_user', `user:${userId}`, {});
    res.json({ ...user, groups: groupsWithPermissions });
  })
);

const createUserSchema = z.object({
  username: z.string().min(1).max(128),
  password: z.string().min(1).max(512),
  role: z.string().max(64).optional(),
});

router.post(
  '/',
  authMiddleware,
  validate(createUserSchema),
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    requireAdmin(req);
    const { username, password, role } = req.body as z.infer<typeof createUserSchema>;
    assertPasswordPolicy(password);

    const existing = await pool.query(
      'SELECT id FROM users WHERE workspace_id = $1 AND username = $2',
      [req.user.workspaceId, username]
    );
    if (existing.rows.length > 0) {
      throw new AppError('user_exists', 409);
    }

    const hash = await bcrypt.hash(password, config.auth.bcryptRounds);
    const id = await createUser(req.user.workspaceId, username, hash, role || 'member');
    await insertAudit(req.user.workspaceId, req.user.sub, 'create_user', `user:${id}`, {
      username,
      role: role || 'member',
    });
    res.json({ id, username, role: role || 'member' });
  })
);

router.delete(
  '/:userId',
  authMiddleware,
  validate(userIdParam, 'params'),
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    requireAdmin(req);
    const userId = (req.params as any).userId as number;

    if (req.user.sub === userId) {
      throw new AppError('admin_cannot_delete_self', 400);
    }

    const userResult = await pool.query(
      'SELECT id, username FROM users WHERE id = $1 AND workspace_id = $2',
      [userId, req.user.workspaceId]
    );
    if (userResult.rows.length === 0) throw new AppError('user_not_found', 404);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Preserve audit history: NULL out user_id instead of deleting
      await client.query('UPDATE audit_logs SET user_id = NULL WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM user_groups WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM user_buckets WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM users WHERE id = $1', [userId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    await insertAudit(req.user.workspaceId, req.user.sub, 'delete_user', `user:${userId}`, {});
    res.json({ ok: true, message: 'user_deleted', userId });
  })
);

const updateUserSchema = z.object({
  username: z.string().min(1).max(128).optional(),
  role: z.string().max(64).optional(),
  is_active: z.boolean().optional(),
});

router.put(
  '/:userId',
  authMiddleware,
  validate(userIdParam, 'params'),
  validate(updateUserSchema),
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    const userId = (req.params as any).userId as number;
    if (req.user.role !== 'admin' && req.user.sub !== userId) {
      throw new AppError('forbidden', 403);
    }

    const body = req.body as z.infer<typeof updateUserSchema>;
    const userResult = await pool.query(
      'SELECT id FROM users WHERE id = $1 AND workspace_id = $2',
      [userId, req.user.workspaceId]
    );
    if (userResult.rows.length === 0) throw new AppError('user_not_found', 404);

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (body.username !== undefined) {
      const existing = await pool.query(
        'SELECT id FROM users WHERE workspace_id = $1 AND username = $2 AND id != $3',
        [req.user.workspaceId, body.username, userId]
      );
      if (existing.rows.length > 0) {
        throw new AppError('username_taken', 409);
      }
      updates.push(`username = $${paramIndex++}`);
      values.push(body.username);
    }
    if (body.role !== undefined && req.user.role === 'admin') {
      updates.push(`role = $${paramIndex++}`);
      values.push(body.role);
    }
    if (body.is_active !== undefined && req.user.role === 'admin') {
      updates.push(`is_active = $${paramIndex++}`);
      values.push(body.is_active);
    }
    if (updates.length === 0) throw new AppError('no_updates_provided', 400);

    values.push(userId);
    await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex}`, values);
    await insertAudit(req.user.workspaceId, req.user.sub, 'update_user', `user:${userId}`, {
      updates: Object.keys(body),
    });
    res.json({ ok: true });
  })
);

const resetPasswordSchema = z.object({
  newPassword: z.string().min(1).max(512).optional(),
  must_change: z.boolean().optional(),
});

router.post(
  '/:userId/reset-password',
  authMiddleware,
  validate(userIdParam, 'params'),
  validate(resetPasswordSchema),
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    requireAdmin(req);
    const userId = (req.params as any).userId as number;
    const { newPassword, must_change } = req.body as z.infer<typeof resetPasswordSchema>;

    const userResult = await pool.query(
      'SELECT id, username FROM users WHERE id = $1 AND workspace_id = $2',
      [userId, req.user.workspaceId]
    );
    if (userResult.rows.length === 0) throw new AppError('user_not_found', 404);

    let passwordToStore = newPassword;
    let generatedTemp: string | null = null;
    if (!passwordToStore) {
      const rand = require('crypto').randomBytes(12).toString('base64url');
      generatedTemp = `Tmp${rand}9`;
      passwordToStore = generatedTemp;
    } else {
      assertPasswordPolicy(passwordToStore);
    }

    const hash = await bcrypt.hash(passwordToStore, config.auth.bcryptRounds);
    const setMustChange = (generatedTemp ? true : !!must_change);
    await pool.query(
      'UPDATE users SET password_hash = $1, must_change_password = $2 WHERE id = $3',
      [hash, setMustChange, userId]
    );
    await insertAudit(req.user.workspaceId, req.user.sub, 'reset_password', `user:${userId}`, {
      generatedTemp: !!generatedTemp,
      must_change: setMustChange,
    });

    const resp: any = { ok: true };
    if (generatedTemp) resp.tempPassword = generatedTemp;
    res.json(resp);
  })
);

const statusSchema = z.object({ is_active: z.boolean() });

router.patch(
  '/:userId/status',
  authMiddleware,
  validate(userIdParam, 'params'),
  validate(statusSchema),
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    requireAdmin(req);
    const userId = (req.params as any).userId as number;
    const { is_active } = req.body as z.infer<typeof statusSchema>;
    await pool.query(
      'UPDATE users SET is_active = $1 WHERE id = $2 AND workspace_id = $3',
      [is_active, userId, req.user.workspaceId]
    );
    await insertAudit(req.user.workspaceId, req.user.sub, 'set_user_active', `user:${userId}`, {
      is_active,
    });
    res.json({ ok: true, is_active });
  })
);

export default router;
