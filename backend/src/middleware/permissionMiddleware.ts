// backend/src/middleware/permissionMiddleware.ts
import { Response, NextFunction } from 'express';
import { db } from '../db';
import { AuthRequest } from './authMiddleware';

/**
 * Group/permission-based authorization. Admin role bypasses all checks.
 * For non-admins: the user must have an explicit permission row whose
 * resource matches `resource` exactly OR matches `resource:*` (specific resource),
 * and whose access is the requested level or 'read-write'.
 *
 * Default-deny on missing rules.
 */
export function permissionMiddleware(resource: string, access: 'read' | 'write') {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' });
    if (req.user.role === 'admin') return next();

    const stmt = db.prepare(`
      SELECT p.access FROM permissions p
      JOIN user_groups ug ON ug.group_id = p.group_id
      WHERE ug.user_id = ? AND (p.resource = ? OR p.resource LIKE ?)
    `);
    const rows = stmt.all(req.user.sub, resource, resource + ':%') as Array<{ access: string }>;

    const allowed = rows.some((r) => r.access === access || r.access === 'read-write');
    if (!allowed) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}
