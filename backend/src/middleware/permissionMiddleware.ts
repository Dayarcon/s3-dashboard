// backend/src/middleware/permissionMiddleware.ts
import { Response, NextFunction } from 'express';
import { pool } from '../db';
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
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' });
    if (req.user.role === 'admin') return next();

    try {
      const result = await pool.query(
        `SELECT p.access FROM permissions p
         JOIN user_groups ug ON ug.group_id = p.group_id
         JOIN groups g ON g.id = p.group_id
         WHERE ug.user_id = $1 AND g.workspace_id = $2
           AND (p.resource = $3 OR p.resource LIKE $4)`,
        [req.user.sub, req.user.workspaceId, resource, resource + ':%']
      );

      const allowed = result.rows.some(
        (r: any) => r.access === access || r.access === 'read-write'
      );
      if (!allowed) return res.status(403).json({ error: 'forbidden' });
      next();
    } catch (err) {
      return res.status(500).json({ error: 'permission_check_failed' });
    }
  };
}
