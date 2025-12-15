// backend/src/auth.ts
import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { findUserByUsername, createUser, insertAudit, db, getAllowedBucketsForUser } from './db';
import { authMiddleware, AuthRequest } from './middleware/authMiddleware';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';

type User = {
    id: number;
    username: string;
    password_hash: string;
    role: string;
    is_active: number;
};

// login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username/password required' });

  const user = findUserByUsername(username) as User | undefined;
  if (!user || !user.is_active) return res.status(401).json({ error: 'invalid credentials' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });

  const token = jwt.sign({ sub: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions);

  insertAudit(user.id, 'login', 'auth', { ip: req.ip, username });
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

// optional: create user (only admin)
router.post('/signup', async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username/password required' });

  // you may want to protect this endpoint behind admin-only in production
  const existing = findUserByUsername(username);
  if (existing) return res.status(409).json({ error: 'user exists' });

  const hash = await bcrypt.hash(password, 10);
  const id = createUser(username, hash, role || 'developer');
  insertAudit(id as number, 'signup', 'auth', { username, role });
  res.json({ id, username, role: role || 'developer' });
});

// logout
router.post('/logout', authMiddleware, async (req: AuthRequest, res) => {
    if (req.user) {
      insertAudit(req.user.sub, 'logout', 'auth', { ip: req.ip });
    }
    res.json({ ok: true });
  });
  
  // Change password
  router.post('/change-password', authMiddleware, async (req: AuthRequest, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'current_password_and_new_password_required' });
    }
  
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'password_too_short' });
    }
  
    const user = findUserByUsername(req.user!.username) as User | undefined;
    if (!user) return res.status(404).json({ error: 'user_not_found' });
  
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'invalid_current_password' });
  
    const hash = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
    
    insertAudit(user.id, 'password_change', 'auth', { ip: req.ip });
    res.json({ ok: true });
  });
  
  // Refresh token (optional - extend token expiry)
  router.post('/refresh', authMiddleware, async (req: AuthRequest, res) => {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' });
    
    const user = findUserByUsername(req.user.username) as User | undefined;
    if (!user || !user.is_active) return res.status(401).json({ error: 'user_inactive' });
  
    const token = jwt.sign(
      { sub: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions
    );
  
    res.json({ token });
  });

// Current user info + permissions + allowed buckets
router.get('/me', authMiddleware, (req: AuthRequest, res) => {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  try {
    const userId = req.user.sub;
    const user = db.prepare('SELECT id, username, role, is_active FROM users WHERE id = ?').get(userId) as any;
    if (!user) return res.status(404).json({ error: 'user_not_found' });

    // gather permissions from groups
    const perms = db.prepare(`
      SELECT DISTINCT p.resource, p.access
      FROM permissions p
      JOIN user_groups ug ON ug.group_id = p.group_id
      WHERE ug.user_id = ?
    `).all(userId) as Array<{ resource: string; access: string }>;

    const allowedBuckets = getAllowedBucketsForUser(userId);

    res.json({ user: { id: user.id, username: user.username, role: user.role }, permissions: perms, allowedBuckets });
  } catch (err: any) {
    console.error('me_error', err);
    res.status(500).json({ error: 'failed_to_get_me', detail: err.message });
  }
});
export default router;
