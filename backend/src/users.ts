import express from 'express';
import { db } from './db';
import { createUser } from './db';
import bcrypt from 'bcrypt';
import { authMiddleware, AuthRequest } from './middleware/authMiddleware';

const router = express.Router();

// List all users
router.get('/', authMiddleware, (req: AuthRequest, res) => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'only admin can list users' });
    }
  
    try {
      const rows = db.prepare(`
        SELECT 
          u.id,
          u.username,
          u.role,
          u.is_active,
          u.created_at,
          g.id as group_id,
          g.name as group_name
        FROM users u
        LEFT JOIN user_groups ug ON ug.user_id = u.id
        LEFT JOIN groups g ON g.id = ug.group_id
        ORDER BY u.created_at DESC
      `).all() as Array<{
        id: number;
        username: string;
        role: string;
        is_active: number;
        created_at: string;
        group_id: number | null;
        group_name: string | null;
      }>;
  
      // Group rows per user
      const usersMap: Record<number, any> = {};
  
      for (const row of rows) {
        if (!usersMap[row.id]) {
          usersMap[row.id] = {
            id: row.id,
            username: row.username,
            role: row.role,
            is_active: row.is_active,
            created_at: row.created_at,
            groups: []
          };
        }
  
        if (row.group_id) {
          usersMap[row.id].groups.push({
            id: row.group_id,
            name: row.group_name
          });
        }
      }
  
      res.json(Object.values(usersMap));
    } catch (err: any) {
      res.status(500).json({ error: 'failed_to_list_users', detail: err.message });
    }
  });

// Get user details by ID (including groups and permissions)
router.get('/:userId', authMiddleware, (req: AuthRequest, res) => {
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'only admin can view user details' });
    }
    try {
        const userId = Number(req.params.userId);
        if (!userId || isNaN(userId)) {
            return res.status(400).json({ error: 'invalid user id' });
        }

        // Get user basic info
        const user = db.prepare('SELECT id, username, role, is_active, created_at FROM users WHERE id = ?').get(userId);
        if (!user) {
            return res.status(404).json({ error: 'user not found' });
        }

        // Get user's groups
        const userGroups = db.prepare(`
            SELECT g.id, g.name, g.created_at
            FROM groups g
            INNER JOIN user_groups ug ON g.id = ug.group_id
            WHERE ug.user_id = ?
        `).all(userId);

        // Get permissions for each group
        const groupsWithPermissions = userGroups.map((group: any) => {
            const permissions = db.prepare(`
                SELECT id, resource, access
                FROM permissions
                WHERE group_id = ?
            `).all(group.id);
            return {
                ...group,
                permissions
            };
        });

        res.json({
            ...user,
            groups: groupsWithPermissions
        });
    } catch (err: any) {
        res.status(500).json({ error: 'failed_to_get_user_details', detail: err.message });
    }
});

// Create user
router.post('/', authMiddleware, async (req: AuthRequest, res) => {
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'only admin can create users' });
    }
    const { username, password, role } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'username and password required' });
    }
    try {
        // Check if user already exists
        const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
        if (existing) {
            return res.status(409).json({ error: 'user already exists' });
        }
        
        const hash = await bcrypt.hash(password, 10);
        const id = createUser(username, hash, role || 'user');
        res.json({ id, username, role: role || 'user' });
    } catch (err: any) {
        res.status(500).json({ error: 'user_creation_failed', detail: err.message });
    }
});

// Delete user
router.delete('/:userId', authMiddleware, (req: AuthRequest, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'only admin can delete users' });
  }

  const userId = Number(req.params.userId);

  if (!userId || isNaN(userId)) {
    return res.status(400).json({ error: 'invalid user id' });
  }

  // Prevent admin deleting himself
  if (req.user.sub === userId) {  // Changed from req.user.id to req.user.sub
    return res.status(400).json({ error: 'admin_cannot_delete_self' });
  }

  try {
    const user = db
      .prepare('SELECT id, username FROM users WHERE id = ?')
      .get(userId);

    if (!user) {
      return res.status(404).json({ error: 'user_not_found' });
    }

    const tx = db.transaction(() => {
      // Delete audit logs for this user (or set user_id to NULL to preserve history)
      // Option 1: Delete audit logs
      db.prepare('DELETE FROM audit_logs WHERE user_id = ?').run(userId);
      
      // Option 2: If you want to preserve audit history, set user_id to NULL instead:
      // db.prepare('UPDATE audit_logs SET user_id = NULL WHERE user_id = ?').run(userId);
      
      // Remove user from groups
      db.prepare('DELETE FROM user_groups WHERE user_id = ?').run(userId);

      // Delete user
      db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    });

    tx();

    res.json({
      ok: true,
      message: 'user_deleted',
      userId
    });
  } catch (err: any) {
    res.status(500).json({
      error: 'failed_to_delete_user',
      detail: err.message
    });
  }
});

router.put('/:userId', authMiddleware, async (req: AuthRequest, res) => {
  if (req.user?.role !== 'admin' && req.user?.sub !== Number(req.params.userId)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const userId = Number(req.params.userId);
  const { username, role, is_active } = req.body;

  try {
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'user_not_found' });

    const updates: string[] = [];
    const values: any[] = [];

    if (username !== undefined) {
      const existing = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, userId);
      if (existing) return res.status(409).json({ error: 'username_taken' });
      updates.push('username = ?');
      values.push(username);
    }

    if (role !== undefined && req.user?.role === 'admin') {
      updates.push('role = ?');
      values.push(role);
    }

    if (is_active !== undefined && req.user?.role === 'admin') {
      updates.push('is_active = ?');
      values.push(is_active ? 1 : 0);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'no_updates_provided' });
    }

    values.push(userId);
    const sql = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
    db.prepare(sql).run(...values);

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: 'update_failed', detail: err.message });
  }
});

// Activate/Deactivate user
router.patch('/:userId/status', authMiddleware, (req: AuthRequest, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'admin_only' });
  }

  const userId = Number(req.params.userId);
  const { is_active } = req.body;

  if (typeof is_active !== 'boolean') {
    return res.status(400).json({ error: 'is_active_must_be_boolean' });
  }

  try {
    db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(is_active ? 1 : 0, userId);
    res.json({ ok: true, is_active });
  } catch (err: any) {
    res.status(500).json({ error: 'status_update_failed', detail: err.message });
  }
});
  
export default router;
