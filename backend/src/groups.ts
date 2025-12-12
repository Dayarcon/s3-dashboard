import express from 'express';
import { db } from './db';
import { authMiddleware, AuthRequest } from './middleware/authMiddleware';

const router = express.Router();

// create group
router.post('/', authMiddleware, (req: AuthRequest, res) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'only admin can create group' });
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    try {
        const stmt = db.prepare('INSERT INTO groups (name) VALUES (?)');
        const info = stmt.run(name);
        res.json({ id: info.lastInsertRowid, name });
    } catch (err: any) {
        res.status(500).json({ error: 'group_creation_failed', detail: err.message });
    }
});

// list all groups
router.get('/', authMiddleware, (req: AuthRequest, res) => {
    const stmt = db.prepare('SELECT id, name, created_at FROM groups');
    const groups = stmt.all();
    res.json(groups);
});

// assign permissions to group
router.post('/:groupId/permissions', authMiddleware, (req: AuthRequest, res) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'only admin can assign permissions' });
    const groupId = Number(req.params.groupId);
    const { resource, access } = req.body;
    if (!resource || !access) return res.status(400).json({ error: 'resource and access required' });
    try {
        const stmt = db.prepare('INSERT INTO permissions (group_id, resource, access) VALUES (?, ?, ?)');
        stmt.run(groupId, resource, access);
        res.json({ ok: true });
    } catch (err: any) {
        res.status(500).json({ error: 'permission_assignment_failed', detail: err.message });
    }
});

// assign user to group
router.post('/users/:userId/groups', authMiddleware, (req: AuthRequest, res) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'only admin can assign users' });
    const userId = Number(req.params.userId);
    const { groupId } = req.body;
    if (!groupId) return res.status(400).json({ error: 'groupId required' });
    try {
        const stmt = db.prepare('INSERT INTO user_groups (user_id, group_id) VALUES (?, ?)');
        stmt.run(userId, groupId);
        res.json({ ok: true });
    } catch (err: any) {
        res.status(500).json({ error: 'assign_user_group_failed', detail: err.message });
    }
});

export default router;
