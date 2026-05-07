import express from 'express';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from './middleware/authMiddleware';
import { getAllBucketsWithMetrics, getDetailedBucketMetrics } from './s3';
import { getAllowedBucketsForUser, totalBucketAssignments } from './db';
import { asyncHandler, AppError } from './errors';
import { validate } from './validate';
import { formatBytes } from './utils';
import { config } from './config';

const router = express.Router();

/**
 * Apply the same visibility model used by /api/buckets:
 *  - admin: all
 *  - non-admin with explicit assignments: only those buckets
 *  - non-admin without assignments, but assignments exist somewhere: empty
 *  - non-admin and zero assignments anywhere: empty in production (default-deny);
 *    permissive in development only when explicitly enabled.
 */
function filterByVisibility<T extends { name?: string }>(
  user: NonNullable<AuthRequest['user']>,
  buckets: T[]
): T[] {
  if (user.role === 'admin') return buckets;

  const allowed = getAllowedBucketsForUser(user.sub);
  if (Array.isArray(allowed) && allowed.length > 0) {
    return buckets.filter((b) => b.name && allowed.includes(b.name));
  }

  if (totalBucketAssignments() > 0) return [];

  // Bootstrap: no assignments configured anywhere. In production this is treated
  // as default-deny. In development we keep the friendly behavior but log it.
  if (config.isProd) return [];
  return buckets;
}

router.get(
  '/buckets',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    const all = await getAllBucketsWithMetrics();
    res.json(filterByVisibility(req.user, all));
  })
);

const bucketParamSchema = z.object({ name: z.string().min(1).max(255) });

router.get(
  '/bucket/:name',
  authMiddleware,
  validate(bucketParamSchema, 'params'),
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    const bucketName = (req.params as any).name as string;

    if (req.user.role !== 'admin') {
      const allowed = getAllowedBucketsForUser(req.user.sub);
      if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(bucketName)) {
        throw new AppError('forbidden_bucket', 403);
      }
      // No explicit allow-list: fall back to bucket-visibility rules.
      if (!Array.isArray(allowed) || allowed.length === 0) {
        if (totalBucketAssignments() > 0) throw new AppError('forbidden_bucket', 403);
        if (config.isProd) throw new AppError('forbidden_bucket', 403);
      }
    }

    const metrics = await getDetailedBucketMetrics(bucketName);
    res.json(metrics);
  })
);

router.get(
  '/summary',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    const all = await getAllBucketsWithMetrics();
    const visible = filterByVisibility(req.user, all);

    const totalStorage = visible.reduce((sum, b: any) => sum + (b.totalSize || 0), 0);
    const totalObjects = visible.reduce((sum, b: any) => sum + (b.objectCount || 0), 0);

    // Run detailed-metric calls in parallel rather than sequentially.
    const detailedResults = await Promise.allSettled(
      visible.map((b: any) => getDetailedBucketMetrics(b.name))
    );

    const storageClassBreakdown: Record<string, { size: number; count: number }> = {};
    for (const r of detailedResults) {
      if (r.status !== 'fulfilled') continue;
      for (const sc of r.value.storageClasses || []) {
        if (!storageClassBreakdown[sc.name]) storageClassBreakdown[sc.name] = { size: 0, count: 0 };
        storageClassBreakdown[sc.name].size += sc.size;
        storageClassBreakdown[sc.name].count += sc.count;
      }
    }

    res.json({
      totalStorage,
      totalStorageFormatted: formatBytes(totalStorage),
      totalObjects,
      bucketCount: visible.length,
      buckets: visible.map((b: any) => ({
        name: b.name,
        size: b.totalSize,
        sizeFormatted: b.sizeFormatted,
        objects: b.objectCount,
      })),
      storageClassBreakdown: Object.entries(storageClassBreakdown).map(([name, data]) => ({
        name,
        ...data,
        sizeFormatted: formatBytes(data.size),
      })),
    });
  })
);

const regionsQuerySchema = z.object({
  regions: z.string().optional(),
});

router.get(
  '/buckets/regions',
  authMiddleware,
  validate(regionsQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    const regionsParam = (req.query as any).regions as string | undefined;
    const regions = regionsParam
      ? regionsParam.split(',').map((r) => r.trim()).filter(Boolean)
      : [];
    let all = await getAllBucketsWithMetrics();
    if (regions.length > 0) {
      const set = new Set(regions);
      all = all.filter((m: any) => m.location && set.has(m.location));
    }
    res.json(filterByVisibility(req.user, all));
  })
);

export default router;
