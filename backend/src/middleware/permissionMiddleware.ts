import { db } from '../db';
import { AuthRequest } from './authMiddleware';
import { Request, Response, NextFunction } from 'express';

export function permissionMiddleware(resource: string, access: 'read' | 'write') {
    return (req: AuthRequest, res: Response, next: NextFunction) => {
        if (!req.user) return res.status(401).json({ error: 'unauthorized' });

        // get permissions from all groups user belongs to
        const stmt = db.prepare(`
            SELECT p.access FROM permissions p
            JOIN user_groups ug ON ug.group_id = p.group_id
            WHERE ug.user_id = ?
        `);
        const rows = stmt.all(req.user.sub);

        let allowed = rows.some(r => r.access === access || r.access === 'read-write');

        // default read access if user is not in any group
        if (!allowed && access === 'read' && rows.length === 0) {
            allowed = true;
        }

        if (!allowed) return res.status(403).json({ error: 'forbidden' });

        next();
    }
}
