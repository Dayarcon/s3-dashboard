// backend/src/auth.ts
import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { findUserByUsername, createUser, insertAudit } from './db';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';

// login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username/password required' });

  const user = findUserByUsername(username);
  if (!user || !user.is_active) return res.status(401).json({ error: 'invalid credentials' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });

  const token = jwt.sign({ sub: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

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

export default router;
