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
        const stmt = db.prepare('SELECT id, username, role, is_active, created_at FROM users');
        const users = stmt.all();
        res.json(users);
    } catch (err: any) {
        res.status(500).json({ error: 'failed_to_list_users', detail: err.message });
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

export default router;
