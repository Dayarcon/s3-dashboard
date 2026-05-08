import express from 'express';
import { z } from 'zod';
import { pool, insertAudit, createGroup, deleteGroup } from './db';
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
    if (!req.user) throw new AppError('unauthorized', 401);
    requireAdmin(req);
    const { name } = req.body as z.infer<typeof createGroupSchema>;

    const existing = await pool.query(
      'SELECT id FROM groups WHERE workspace_id = $1 AND name = $2',
      [req.user.workspaceId, name]
    );
    if (existing.rows.length > 0) {
      throw new AppError('group_already_exists', 409);
    }

    const id = await createGroup(req.user.workspaceId, name);
    await insertAudit(req.user.workspaceId, req.user.sub, 'create_group', `group:${name}`, {
      groupId: id,
    });
    res.json({ id, name });
  })
);

router.get(
  '/',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    requireAdmin(req);

    const result = await pool.query(
      'SELECT id, name, created_at FROM groups WHERE workspace_id = $1 ORDER BY created_at DESC',
      [req.user.workspaceId]
    );
    await insertAudit(req.user.workspaceId, req.user.sub, 'list_groups', 'groups', {});
    res.json(result.rows);
  })
);

router.get(
  '/:id',
  authMiddleware,
  validate(groupIdParam, 'params'),
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    requireAdmin(req);
    const groupId = (req.params as any).id as number;

    const groupResult = await pool.query(
      'SELECT id, name, created_at FROM groups WHERE id = $1 AND workspace_id = $2',
      [groupId, req.user.workspaceId]
    );
    if (groupResult.rows.length === 0) throw new AppError('group_not_found', 404);
    const group = groupResult.rows[0];

    const usersResult = await pool.query(
      `SELECT u.id, u.username
       FROM users u
       JOIN user_groups ug ON ug.user_id = u.id
       WHERE ug.group_id = $1 AND u.workspace_id = $2`,
      [groupId, req.user.workspaceId]
    );

    const permResult = await pool.query(
      'SELECT id, resource, access FROM permissions WHERE group_id = $1',
      [groupId]
    );

    const bucketsResult = await pool.query(
      'SELECT id, bucket_name FROM group_buckets WHERE group_id = $1',
      [groupId]
    );

    await insertAudit(req.user.workspaceId, req.user.sub, 'view_group', `group:${groupId}`, {});
    res.json({
      group,
      users: usersResult.rows,
      permissions: permResult.rows,
      buckets: bucketsResult.rows,
    });
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
    if (!req.user) throw new AppError('unauthorized', 401);
    requireAdmin(req);
    const groupId = (req.params as any).groupId as number;
    const { resource, access } = req.body as z.infer<typeof permissionSchema>;

    const existing = await pool.query(
      'SELECT id FROM permissions WHERE group_id = $1 AND resource = $2',
      [groupId, resource]
    );

    if (existing.rows.length > 0) {
      const permId = existing.rows[0].id;
      await pool.query('UPDATE permissions SET access = $1 WHERE id = $2', [access, permId]);
      await insertAudit(req.user.workspaceId, req.user.sub, 'update_permission', `group:${groupId}`, {
        permissionId: permId,
        resource,
        access,
      });
      return res.json({ ok: true, updated: true, id: permId });
    }

    const result = await pool.query(
      'INSERT INTO permissions (group_id, resource, access) VALUES ($1, $2, $3) RETURNING id',
      [groupId, resource, access]
    );
    const permId = result.rows[0].id;
    await insertAudit(req.user.workspaceId, req.user.sub, 'add_permission', `group:${groupId}`, {
      permissionId: permId,
      resource,
      access,
    });
    res.json({ ok: true, id: permId });
  })
);

const bucketSchema = z.object({ bucket_name: z.string().min(1).max(255) });

router.post(
  '/:groupId/buckets',
  authMiddleware,
  validate(groupIdParamAlt, 'params'),
  validate(bucketSchema),
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    requireAdmin(req);
    const groupId = (req.params as any).groupId as number;
    const { bucket_name } = req.body as z.infer<typeof bucketSchema>;

    const existing = await pool.query(
      'SELECT id FROM group_buckets WHERE group_id = $1 AND bucket_name = $2',
      [groupId, bucket_name]
    );
    if (existing.rows.length > 0) {
      throw new AppError('bucket_already_assigned', 409);
    }

    const result = await pool.query(
      'INSERT INTO group_buckets (group_id, bucket_name) VALUES ($1, $2) RETURNING id',
      [groupId, bucket_name]
    );
    await insertAudit(req.user.workspaceId, req.user.sub, 'assign_bucket', `group:${groupId}`, {
      bucket: bucket_name,
      id: result.rows[0].id,
    });
    res.json({ ok: true });
  })
);

router.get(
  '/:groupId/buckets',
  authMiddleware,
  validate(groupIdParamAlt, 'params'),
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    requireAdmin(req);
    const groupId = (req.params as any).groupId as number;

    const result = await pool.query(
      'SELECT id, bucket_name FROM group_buckets WHERE group_id = $1',
      [groupId]
    );
    await insertAudit(req.user.workspaceId, req.user.sub, 'list_group_buckets', `group:${groupId}`, {});
    res.json(result.rows);
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
    if (!req.user) throw new AppError('unauthorized', 401);
    requireAdmin(req);
    const groupId = (req.params as any).groupId as number;
    const bucketName = decodeURIComponent((req.params as any).bucketName as string);

    await pool.query(
      'DELETE FROM group_buckets WHERE group_id = $1 AND bucket_name = $2',
      [groupId, bucketName]
    );
    await insertAudit(req.user.workspaceId, req.user.sub, 'remove_bucket', `group:${groupId}`, {
      bucket: bucketName,
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
    if (!req.user) throw new AppError('unauthorized', 401);
    requireAdmin(req);
    const permissionId = (req.params as any).permissionId as number;

    await pool.query('DELETE FROM permissions WHERE id = $1', [permissionId]);
    await insertAudit(req.user.workspaceId, req.user.sub, 'remove_permission', `group:${(req.params as any).groupId}`, {
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
    if (!req.user) throw new AppError('unauthorized', 401);
    requireAdmin(req);
    const userId = (req.params as any).userId as number;
    const { groupId } = req.body as z.infer<typeof assignUserSchema>;

    const existing = await pool.query(
      'SELECT id FROM user_groups WHERE user_id = $1 AND group_id = $2',
      [userId, groupId]
    );
    if (existing.rows.length > 0) {
      throw new AppError('user_already_in_group', 409);
    }

    await pool.query(
      'INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2)',
      [userId, groupId]
    );
    await insertAudit(req.user.workspaceId, req.user.sub, 'assign_user_to_group', `group:${groupId}`, {
      userId,
    });
    res.json({ ok: true });
  })
);

router.delete(
  '/:groupId/users/:userId',
  authMiddleware,
  validate(groupAndUserParams, 'params'),
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    requireAdmin(req);
    const { groupId, userId } = req.params as unknown as z.infer<typeof groupAndUserParams>;

    await pool.query(
      'DELETE FROM user_groups WHERE group_id = $1 AND user_id = $2',
      [groupId, userId]
    );
    await insertAudit(req.user.workspaceId, req.user.sub, 'remove_user_from_group', `group:${groupId}`, {
      userId,
    });
    res.json({ ok: true });
  })
);

router.delete(
  '/:id',
  authMiddleware,
  validate(groupIdParam, 'params'),
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    requireAdmin(req);
    const groupId = (req.params as any).id as number;

    const groupResult = await pool.query(
      'SELECT id FROM groups WHERE id = $1 AND workspace_id = $2',
      [groupId, req.user.workspaceId]
    );
    if (groupResult.rows.length === 0) throw new AppError('group_not_found', 404);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM permissions WHERE group_id = $1', [groupId]);
      await client.query('DELETE FROM user_groups WHERE group_id = $1', [groupId]);
      await client.query('DELETE FROM group_buckets WHERE group_id = $1', [groupId]);
      await client.query('DELETE FROM groups WHERE id = $1', [groupId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    await insertAudit(req.user.workspaceId, req.user.sub, 'delete_group', `group:${groupId}`, {});
    res.json({ ok: true });
  })
);

export default router;
