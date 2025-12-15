import express from 'express';
import { db } from './db';
import { authMiddleware, AuthRequest } from './middleware/authMiddleware';

const router = express.Router();

/* ---------------------------------------------------
   Helpers
--------------------------------------------------- */

function requireAdmin(req: AuthRequest, res: express.Response): boolean {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'admin_only' });
    return false;
  }
  return true;
}

/* ---------------------------------------------------
   Create Group
--------------------------------------------------- */
router.post('/', authMiddleware, (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return;

  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name_required' });

  const existing = db.prepare(`SELECT id FROM groups WHERE name=?`).get(name);
  if (existing) {
    return res.status(409).json({ error: 'group_already_exists' });
  }

  const info = db.prepare(
    `INSERT INTO groups (name) VALUES (?)`
  ).run(name);

  res.json({ id: info.lastInsertRowid, name });
});

/* ---------------------------------------------------
   List Groups
--------------------------------------------------- */
router.get('/', authMiddleware, (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return;

  const groups = db.prepare(
    `SELECT id, name, created_at FROM groups ORDER BY created_at DESC`
  ).all();

  res.json(groups);
});

/* ---------------------------------------------------
   Get Group Details (users + permissions)
--------------------------------------------------- */
router.get('/:id', authMiddleware, (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return;

  const groupId = Number(req.params.id);

  const group = db.prepare(
    `SELECT id, name, created_at FROM groups WHERE id=?`
  ).get(groupId);

  if (!group) return res.status(404).json({ error: 'group_not_found' });

  const users = db.prepare(`
    SELECT u.id, u.username
    FROM users u
    JOIN user_groups ug ON ug.user_id = u.id
    WHERE ug.group_id = ?
  `).all(groupId);

  const permissions = db.prepare(`
    SELECT id, resource, access
    FROM permissions
    WHERE group_id = ?
  `).all(groupId);

  const buckets = db.prepare(`
    SELECT id, bucket_name FROM group_buckets WHERE group_id = ?
  `).all(groupId) as Array<{ id: number; bucket_name: string }>;

  res.json({ group, users, permissions, buckets });
});

/* ---------------------------------------------------
   Assign Permission to Group
--------------------------------------------------- */
router.post('/:groupId/permissions', authMiddleware, (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return;

  const groupId = Number(req.params.groupId);
  const { resource, access } = req.body;

  if (!resource || !access) {
    return res.status(400).json({ error: 'resource_and_access_required' });
  }

  const exists = db.prepare(`
    SELECT id FROM permissions
    WHERE group_id=? AND resource=? AND access=?
  `).get(groupId, resource, access);

  if (exists) {
    return res.status(409).json({ error: 'permission_already_exists' });
  }

  db.prepare(`
    INSERT INTO permissions (group_id, resource, access)
    VALUES (?, ?, ?)
  `).run(groupId, resource, access);

  res.json({ ok: true });
});

/* ---------------------------------------------------
   Assign Bucket to Group
--------------------------------------------------- */
router.post('/:groupId/buckets', authMiddleware, (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return;
  const groupId = Number(req.params.groupId);
  const { bucket_name } = req.body;
  if (!bucket_name) return res.status(400).json({ error: 'bucket_name_required' });

  const exists = db.prepare(`SELECT id FROM group_buckets WHERE group_id = ? AND bucket_name = ?`).get(groupId, bucket_name);
  if (exists) return res.status(409).json({ error: 'bucket_already_assigned' });

  db.prepare(`INSERT INTO group_buckets (group_id, bucket_name) VALUES (?, ?)`).run(groupId, bucket_name);
  res.json({ ok: true });
});

/* ---------------------------------------------------
   List Group Buckets
--------------------------------------------------- */
router.get('/:groupId/buckets', authMiddleware, (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return;
  const groupId = Number(req.params.groupId);
  const rows = db.prepare(`SELECT id, bucket_name FROM group_buckets WHERE group_id = ?`).all(groupId);
  res.json(rows.map((r: any) => ({ id: r.id, bucket_name: r.bucket_name })));
});

/* ---------------------------------------------------
   Remove Bucket from Group
--------------------------------------------------- */
router.delete('/:groupId/buckets/:bucketName', authMiddleware, (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return;
  const groupId = Number(req.params.groupId);
  const bucketName = decodeURIComponent(String(req.params.bucketName || ''));
  if (!bucketName) return res.status(400).json({ error: 'bucket_name_required' });

  db.prepare(`DELETE FROM group_buckets WHERE group_id = ? AND bucket_name = ?`).run(groupId, bucketName);
  res.json({ ok: true });
});

/* ---------------------------------------------------
   Remove Permission from Group
--------------------------------------------------- */
router.delete(
  '/:groupId/permissions/:permissionId',
  authMiddleware,
  (req: AuthRequest, res) => {
    if (!requireAdmin(req, res)) return;

    const permissionId = Number(req.params.permissionId);

    db.prepare(
      `DELETE FROM permissions WHERE id=?`
    ).run(permissionId);

    res.json({ ok: true });
  }
);

/* ---------------------------------------------------
   Assign User to Group
--------------------------------------------------- */
router.post(
  '/users/:userId/groups',
  authMiddleware,
  (req: AuthRequest, res) => {
    if (!requireAdmin(req, res)) return;

    const userId = Number(req.params.userId);
    const { groupId } = req.body;

    if (!groupId) return res.status(400).json({ error: 'groupId_required' });

    const exists = db.prepare(`
      SELECT id FROM user_groups
      WHERE user_id=? AND group_id=?
    `).get(userId, groupId);

    if (exists) {
      return res.status(409).json({ error: 'user_already_in_group' });
    }

    db.prepare(`
      INSERT INTO user_groups (user_id, group_id)
      VALUES (?, ?)
    `).run(userId, groupId);

    res.json({ ok: true });
  }
);

/* ---------------------------------------------------
   Remove User from Group
--------------------------------------------------- */
router.delete(
  '/:groupId/users/:userId',
  authMiddleware,
  (req: AuthRequest, res) => {
    if (!requireAdmin(req, res)) return;

    const { groupId, userId } = req.params;

    db.prepare(`
      DELETE FROM user_groups
      WHERE group_id=? AND user_id=?
    `).run(groupId, userId);

    res.json({ ok: true });
  }
);

/* ---------------------------------------------------
   Delete Group
--------------------------------------------------- */
router.delete('/:id', authMiddleware, (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return;

  const groupId = Number(req.params.id);

  // Check if group exists
  const group = db.prepare(`SELECT id FROM groups WHERE id=?`).get(groupId);
  if (!group) {
    return res.status(404).json({ error: 'group_not_found' });
  }

  // Delete in transaction to ensure consistency
  const tx = db.transaction(() => {
    // Delete permissions
    db.prepare(`DELETE FROM permissions WHERE group_id=?`).run(groupId);
    // Delete user group associations
    db.prepare(`DELETE FROM user_groups WHERE group_id=?`).run(groupId);
    // Delete the group
    db.prepare(`DELETE FROM groups WHERE id=?`).run(groupId);
  });

  tx();

  res.json({ ok: true });
});

export default router;
