// backend/src/middleware/authMiddleware.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../db';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me';

export interface AuthRequest extends Request {
  user?: { sub: number, username: string, role: string }
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ error: 'missing token' });
  const token = h.slice('Bearer '.length);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    req.user = { sub: payload.sub, username: payload.username, role: payload.role };
    next();
  } catch (e) {
    return res.status(401).json({ error: 'invalid token' });
  }
}
