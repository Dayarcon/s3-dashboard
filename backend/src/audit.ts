import express from 'express';
import { db } from './db';
import { authMiddleware, AuthRequest } from './middleware/authMiddleware';

const router = express.Router();

// Get audit logs
router.get('/', authMiddleware, (req: AuthRequest, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'admin_only' });
  }

  const limit = Number(req.query.limit) || 100;
  const offset = Number(req.query.offset) || 0;
  const userId = req.query.userId ? Number(req.query.userId) : null;
  const action = req.query.action as string | undefined;
  const resource = req.query.resource as string | undefined;

  let sql = `
    SELECT 
      al.id,
      al.user_id,
      u.username,
      al.action,
      al.resource,
      al.details,
      al.created_at
    FROM audit_logs al
    LEFT JOIN users u ON al.user_id = u.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (userId) {
    sql += ' AND al.user_id = ?';
    params.push(userId);
  }
  if (action) {
    sql += ' AND al.action = ?';
    params.push(action);
  }
  if (resource) {
    sql += ' AND al.resource = ?';
    params.push(resource);
  }

  sql += ' ORDER BY al.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const logs = db.prepare(sql).all(...params);

  // Get total count
  let countSql = 'SELECT COUNT(*) as total FROM audit_logs WHERE 1=1';
  const countParams: any[] = [];
  if (userId) {
    countSql += ' AND user_id = ?';
    countParams.push(userId);
  }
  if (action) {
    countSql += ' AND action = ?';
    countParams.push(action);
  }
  if (resource) {
    countSql += ' AND resource = ?';
    countParams.push(resource);
  }

  const total = db.prepare(countSql).get(...countParams)?.total || 0;

  res.json({ logs, total, limit, offset });
});

export default router;