import express from 'express';
import { pool } from './db';
import { authMiddleware, AuthRequest } from './middleware/authMiddleware';
import { AppError, asyncHandler } from './errors';

const router = express.Router();

router.get(
  '/',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    if (req.user.role !== 'admin') {
      throw new AppError('admin_only', 403);
    }

    const limit = Math.min(Number(req.query.limit) || 100, 1000);
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
      WHERE al.workspace_id = $1
    `;
    const params: any[] = [req.user.workspaceId];
    let paramIndex = 2;

    if (userId) {
      sql += ` AND al.user_id = $${paramIndex++}`;
      params.push(userId);
    }
    if (action) {
      sql += ` AND al.action = $${paramIndex++}`;
      params.push(action);
    }
    if (resource) {
      sql += ` AND al.resource = $${paramIndex++}`;
      params.push(resource);
    }

    sql += ` ORDER BY al.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
    params.push(limit, offset);

    const logsResult = await pool.query(sql, params);

    // Get total count
    let countSql = 'SELECT COUNT(*) as total FROM audit_logs WHERE workspace_id = $1';
    const countParams: any[] = [req.user.workspaceId];
    let countParamIndex = 2;

    if (userId) {
      countSql += ` AND user_id = $${countParamIndex++}`;
      countParams.push(userId);
    }
    if (action) {
      countSql += ` AND action = $${countParamIndex++}`;
      countParams.push(action);
    }
    if (resource) {
      countSql += ` AND resource = $${countParamIndex++}`;
      countParams.push(resource);
    }

    const countResult = await pool.query(countSql, countParams);
    const total = parseInt(countResult.rows[0].total) || 0;

    // Parse details JSON
    const parsed = logsResult.rows.map((l: any) => ({
      id: l.id,
      user_id: l.user_id,
      username: l.username,
      action: l.action,
      resource: l.resource,
      details: (() => {
        try {
          return l.details ? (typeof l.details === 'string' ? JSON.parse(l.details) : l.details) : null;
        } catch (e) {
          return l.details;
        }
      })(),
      created_at: l.created_at,
    }));

    res.json({ logs: parsed, total, limit, offset });
  })
);

export default router;
