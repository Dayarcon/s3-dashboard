import express from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { db, createUser, insertAudit } from './db';
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
    requireAdmin(req);

    const rows = db
      .prepare(
        `SELECT u.id, u.username, u.role, u.is_active, u.created_at,
                g.id as group_id, g.name as group_name
         FROM users u
         LEFT JOIN user_groups ug ON ug.user_id = u.id
         LEFT JOIN groups g ON g.id = ug.group_id
         ORDER BY u.created_at DESC`
      )
      .all() as Array<{
      id: number;
      username: string;
      role: string;
      is_active: number;
      created_at: string;
      group_id: number | null;
      group_name: string | null;
    }>;

    const usersMap: Record<number, any> = {};
    for (const row of rows) {
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

    insertAudit(req.user?.sub ?? null, 'list_users', 'users', {});
    res.json(Object.values(usersMap));
  })
);

const userIdParam = z.object({ userId: z.coerce.number().int().positive() });

router.get(
  '/:userId',
  authMiddleware,
  validate(userIdParam, 'params'),
  asyncHandler(async (req: AuthRequest, res) => {
    requireAdmin(req);
    const userId = (req.params as any).userId as number;

    const user = db
      .prepare('SELECT id, username, role, is_active, created_at FROM users WHERE id = ?')
      .get(userId);
    if (!user) throw new AppError('user_not_found', 404);

    const userGroups = db
      .prepare(
        `SELECT g.id, g.name, g.created_at
         FROM groups g
         INNER JOIN user_groups ug ON g.id = ug.group_id
         WHERE ug.user_id = ?`
      )
      .all(userId);

    const groupsWithPermissions = (userGroups as any[]).map((group) => {
      const permissions = db
        .prepare('SELECT id, resource, access FROM permissions WHERE group_id = ?')
        .all(group.id);
      return { ...group, permissions };
    });

    insertAudit(req.user?.sub ?? null, 'view_user', `user:${userId}`, {});
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
    requireAdmin(req);
    const { username, password, role } = req.body as z.infer<typeof createUserSchema>;
    assertPasswordPolicy(password);

    if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
      throw new AppError('user_exists', 409);
    }
    const hash = await bcrypt.hash(password, config.auth.bcryptRounds);
    const id = createUser(username, hash, role || 'user');
    insertAudit(req.user?.sub ?? null, 'create_user', `user:${id}`, {
      username,
      role: role || 'user',
    });
    res.json({ id, username, role: role || 'user' });
  })
);

router.delete(
  '/:userId',
  authMiddleware,
  validate(userIdParam, 'params'),
  asyncHandler(async (req: AuthRequest, res) => {
    requireAdmin(req);
    const userId = (req.params as any).userId as number;

    if (req.user!.sub === userId) {
      throw new AppError('admin_cannot_delete_self', 400);
    }

    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
    if (!user) throw new AppError('user_not_found', 404);

    const tx = db.transaction(() => {
      // Preserve audit history: NULL out the user_id rather than deleting rows.
      db.prepare('UPDATE audit_logs SET user_id = NULL WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM user_groups WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM user_buckets WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    });
    tx();

    insertAudit(req.user?.sub ?? null, 'delete_user', `user:${userId}`, {});
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
    const userId = (req.params as any).userId as number;
    if (req.user?.role !== 'admin' && req.user?.sub !== userId) {
      throw new AppError('forbidden', 403);
    }

    const body = req.body as z.infer<typeof updateUserSchema>;
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) throw new AppError('user_not_found', 404);

    const updates: string[] = [];
    const values: any[] = [];
    if (body.username !== undefined) {
      if (
        db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(body.username, userId)
      ) {
        throw new AppError('username_taken', 409);
      }
      updates.push('username = ?');
      values.push(body.username);
    }
    if (body.role !== undefined && req.user?.role === 'admin') {
      updates.push('role = ?');
      values.push(body.role);
    }
    if (body.is_active !== undefined && req.user?.role === 'admin') {
      updates.push('is_active = ?');
      values.push(body.is_active ? 1 : 0);
    }
    if (updates.length === 0) throw new AppError('no_updates_provided', 400);

    values.push(userId);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    insertAudit(req.user?.sub ?? null, 'update_user', `user:${userId}`, {
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
    requireAdmin(req);
    const userId = (req.params as any).userId as number;
    const { newPassword, must_change } = req.body as z.infer<typeof resetPasswordSchema>;

    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
    if (!user) throw new AppError('user_not_found', 404);

    let passwordToStore = newPassword;
    let generatedTemp: string | null = null;
    if (!passwordToStore) {
      // Generate a strong temporary password that satisfies the policy.
      const rand = require('crypto').randomBytes(12).toString('base64url');
      generatedTemp = `Tmp${rand}9`;
      passwordToStore = generatedTemp;
    } else {
      assertPasswordPolicy(passwordToStore);
    }

    const hash = await bcrypt.hash(passwordToStore, config.auth.bcryptRounds);
    const setMustChange = (generatedTemp ? true : !!must_change) ? 1 : 0;
    db.prepare(
      'UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?'
    ).run(hash, setMustChange, userId);
    insertAudit(req.user?.sub ?? null, 'reset_password', `user:${userId}`, {
      generatedTemp: !!generatedTemp,
      must_change: !!setMustChange,
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
    requireAdmin(req);
    const userId = (req.params as any).userId as number;
    const { is_active } = req.body as z.infer<typeof statusSchema>;
    db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(is_active ? 1 : 0, userId);
    insertAudit(req.user?.sub ?? null, 'set_user_active', `user:${userId}`, { is_active });
    res.json({ ok: true, is_active });
  })
);

export default router;
