import { db } from '../db';
import { AuthRequest } from './authMiddleware';
import { Request, Response, NextFunction } from 'express';

export function permissionMiddleware(resource: string, access: 'read' | 'write') {
    return (req: AuthRequest, res: Response, next: NextFunction) => {
        if (!req.user) return res.status(401).json({ error: 'unauthorized' });

        // Admin has full access
        if (req.user.role === 'admin') {
            return next();
        }


        // get permissions from all groups user belongs to for the requested resource
        // support both generic resource (e.g. 'bucket') and specific resources like 'bucket:my-bucket'
        const stmt = db.prepare(`
            SELECT p.access FROM permissions p
            JOIN user_groups ug ON ug.group_id = p.group_id
            WHERE ug.user_id = ? AND (p.resource = ? OR p.resource LIKE ?)
        `);
        const rows = stmt.all(req.user.sub, resource, resource + ':%') as Array<{ access: string }>;

        let allowed = rows.some(r => r.access === access || r.access === 'read-write');

        // default read access if user is not in any group and no explicit permissions exist for this resource
        if (!allowed && access === 'read' && rows.length === 0) {
            allowed = true;
        }

        if (!allowed) return res.status(403).json({ error: 'forbidden' });

        next();
    }
}
