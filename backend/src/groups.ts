import express from 'express';
import { z } from 'zod';
import { db, insertAudit } from './db';
import { authMiddleware, AuthRequest } from './middleware/authMiddleware';
import { AppError, asyncHandler } from './errors';
import { validate } from './validate';

const router = express.Router();

function requireAdmin(req: AuthRequest) {
  if (req.user?.role !== 'admin') throw new AppError('admin_only', 403);
}

const groupIdParam = z.object({ id: z.coerce.number().int().positive() });
const groupIdParamAlt = z.object({ groupId: z.coerce.number().int().positive() });
const userIdParam = z.object({ userId: z.coerce.number().int().positive() });
const groupAndUserParams = z.object({
  groupId: z.coerce.number().int().positive(),
  userId: z.coerce.number().int().positive(),
});

const createGroupSchema = z.object({ name: z.string().min(1).max(128) });

router.post(
  '/',
  authMiddleware,
  validate(createGroupSchema),
  asyncHandler(async (req: AuthRequest, res) => {
    requireAdmin(req);
    const { name } = req.body as z.infer<typeof createGroupSchema>;
    if (db.prepare('SELECT id FROM groups WHERE name=?').get(name)) {
      throw new AppError('group_already_exists', 409);
    }
    const info = db.prepare('INSERT INTO groups (name) VALUES (?)').run(name);
    insertAudit(req.user?.sub ?? null, 'create_group', `group:${name}`, {
      groupId: info.lastInsertRowid,
    });
    res.json({ id: info.lastInsertRowid, name });
  })
);

router.get(
  '/',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    requireAdmin(req);
    const groups = db
      .prepare('SELECT id, name, created_at FROM groups ORDER BY created_at DESC')
      .all();
    insertAudit(req.user?.sub ?? null, 'list_groups', 'groups', {});
    res.json(groups);
  })
);

router.get(
  '/:id',
  authMiddleware,
  validate(groupIdParam, 'params'),
  asyncHandler(async (req: AuthRequest, res) => {
    requireAdmin(req);
    const groupId = (req.params as any).id as number;

    const group = db
      .prepare('SELECT id, name, created_at FROM groups WHERE id=?')
      .get(groupId);
    if (!group) throw new AppError('group_not_found', 404);

    const users = db
      .prepare(
        `SELECT u.id, u.username
         FROM users u
         JOIN user_groups ug ON ug.user_id = u.id
         WHERE ug.group_id = ?`
      )
      .all(groupId);

    const permissions = db
      .prepare('SELECT id, resource, access FROM permissions WHERE group_id = ?')
      .all(groupId);

    const buckets = db
      .prepare('SELECT id, bucket_name FROM group_buckets WHERE group_id = ?')
      .all(groupId);

    insertAudit(req.user?.sub ?? null, 'view_group', `group:${groupId}`, {});
    res.json({ group, users, permissions, buckets });
  })
);

const permissionSchema = z.object({
  resource: z.string().min(1).max(255),
  access: z.enum(['read', 'write', 'read-write']),
});

router.post(
  '/:groupId/permissions',
  authMiddleware,
  validate(groupIdParamAlt, 'params'),
  validate(permissionSchema),
  asyncHandler(async (req: AuthRequest, res) => {
    requireAdmin(req);
    const groupId = (req.params as any).groupId as number;
    const { resource, access } = req.body as z.infer<typeof permissionSchema>;
    const exists = db
      .prepare('SELECT id FROM permissions WHERE group_id=? AND resource=?')
      .get(groupId, resource) as any;
    if (exists) {
      db.prepare('UPDATE permissions SET access = ? WHERE id = ?').run(access, exists.id);
      insertAudit(req.user?.sub ?? null, 'update_permission', `group:${groupId}`, {
        permissionId: exists.id,
        resource,
        access,
      });
      return res.json({ ok: true, updated: true, id: exists.id });
    }
    const info = db
      .prepare('INSERT INTO permissions (group_id, resource, access) VALUES (?, ?, ?)')
      .run(groupId, resource, access);
    insertAudit(req.user?.sub ?? null, 'add_permission', `group:${groupId}`, {
      permissionId: info.lastInsertRowid,
      resource,
      access,
    });
    res.json({ ok: true, id: info.lastInsertRowid });
  })
);

const bucketSchema = z.object({ bucket_name: z.string().min(1).max(255) });

router.post(
  '/:groupId/buckets',
  authMiddleware,
  validate(groupIdParamAlt, 'params'),
  validate(bucketSchema),
  asyncHandler(async (req: AuthRequest, res) => {
    requireAdmin(req);
    const groupId = (req.params as any).groupId as number;
    const { bucket_name } = req.body as z.infer<typeof bucketSchema>;
    if (
      db
        .prepare('SELECT id FROM group_buckets WHERE group_id = ? AND bucket_name = ?')
        .get(groupId, bucket_name)
    ) {
      throw new AppError('bucket_already_assigned', 409);
    }
    const info = db
      .prepare('INSERT INTO group_buckets (group_id, bucket_name) VALUES (?, ?)')
      .run(groupId, bucket_name);
    insertAudit(req.user?.sub ?? null, 'assign_bucket', `group:${groupId}`, {
      bucket: bucket_name,
      id: info.lastInsertRowid,
    });
    res.json({ ok: true });
  })
);

router.get(
  '/:groupId/buckets',
  authMiddleware,
  validate(groupIdParamAlt, 'params'),
  asyncHandler(async (req: AuthRequest, res) => {
    requireAdmin(req);
    const groupId = (req.params as any).groupId as number;
    const rows = db
      .prepare('SELECT id, bucket_name FROM group_buckets WHERE group_id = ?')
      .all(groupId);
    insertAudit(req.user?.sub ?? null, 'list_group_buckets', `group:${groupId}`, {});
    res.json(rows);
  })
);

const groupAndBucketParams = z.object({
  groupId: z.coerce.number().int().positive(),
  bucketName: z.string().min(1).max(512),
});

router.delete(
  '/:groupId/buckets/:bucketName',
  authMiddleware,
  validate(groupAndBucketParams, 'params'),
  asyncHandler(async (req: AuthRequest, res) => {
    requireAdmin(req);
    const groupId = (req.params as any).groupId as number;
    const bucketName = decodeURIComponent((req.params as any).bucketName as string);
    const info = db
      .prepare('DELETE FROM group_buckets WHERE group_id = ? AND bucket_name = ?')
      .run(groupId, bucketName);
    insertAudit(req.user?.sub ?? null, 'remove_bucket', `group:${groupId}`, {
      bucket: bucketName,
      changes: info.changes,
    });
    res.json({ ok: true });
  })
);

const groupAndPermissionParams = z.object({
  groupId: z.coerce.number().int().positive(),
  permissionId: z.coerce.number().int().positive(),
});

router.delete(
  '/:groupId/permissions/:permissionId',
  authMiddleware,
  validate(groupAndPermissionParams, 'params'),
  asyncHandler(async (req: AuthRequest, res) => {
    requireAdmin(req);
    const permissionId = (req.params as any).permissionId as number;
    db.prepare('DELETE FROM permissions WHERE id=?').run(permissionId);
    insertAudit(req.user?.sub ?? null, 'remove_permission', `group:${(req.params as any).groupId}`, {
      permissionId,
    });
    res.json({ ok: true });
  })
);

const assignUserSchema = z.object({ groupId: z.coerce.number().int().positive() });

router.post(
  '/users/:userId/groups',
  authMiddleware,
  validate(userIdParam, 'params'),
  validate(assignUserSchema),
  asyncHandler(async (req: AuthRequest, res) => {
    requireAdmin(req);
    const userId = (req.params as any).userId as number;
    const { groupId } = req.body as z.infer<typeof assignUserSchema>;
    if (db.prepare('SELECT id FROM user_groups WHERE user_id=? AND group_id=?').get(userId, groupId)) {
      throw new AppError('user_already_in_group', 409);
    }
    db.prepare('INSERT INTO user_groups (user_id, group_id) VALUES (?, ?)').run(userId, groupId);
    insertAudit(req.user?.sub ?? null, 'assign_user_to_group', `group:${groupId}`, { userId });
    res.json({ ok: true });
  })
);

router.delete(
  '/:groupId/users/:userId',
  authMiddleware,
  validate(groupAndUserParams, 'params'),
  asyncHandler(async (req: AuthRequest, res) => {
    requireAdmin(req);
    const { groupId, userId } = req.params as unknown as z.infer<typeof groupAndUserParams>;
    const info = db
      .prepare('DELETE FROM user_groups WHERE group_id=? AND user_id=?')
      .run(groupId, userId);
    insertAudit(req.user?.sub ?? null, 'remove_user_from_group', `group:${groupId}`, {
      userId,
      changes: info.changes,
    });
    res.json({ ok: true });
  })
);

router.delete(
  '/:id',
  authMiddleware,
  validate(groupIdParam, 'params'),
  asyncHandler(async (req: AuthRequest, res) => {
    requireAdmin(req);
    const groupId = (req.params as any).id as number;
    const group = db.prepare('SELECT id FROM groups WHERE id=?').get(groupId);
    if (!group) throw new AppError('group_not_found', 404);
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM permissions WHERE group_id=?').run(groupId);
      db.prepare('DELETE FROM user_groups WHERE group_id=?').run(groupId);
      db.prepare('DELETE FROM group_buckets WHERE group_id=?').run(groupId);
      db.prepare('DELETE FROM groups WHERE id=?').run(groupId);
    });
    tx();
    insertAudit(req.user?.sub ?? null, 'delete_group', `group:${groupId}`, {});
    res.json({ ok: true });
  })
);

export default router;
