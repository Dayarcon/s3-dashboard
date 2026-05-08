import express from 'express';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from './middleware/authMiddleware';
import { getAllBucketsWithMetrics, getDetailedBucketMetrics } from './s3';
import { getAllowedBucketsForUser, totalBucketAssignments, getWorkspace } from './db';
import { asyncHandler, AppError } from './errors';
import { validate } from './validate';
import { formatBytes } from './utils';
import { config } from './config';
import { decrypt } from './crypto';

const router = express.Router();

// Get workspace credentials (decrypted)
async function getWorkspaceCreds(
  workspaceId: number
): Promise<{ accessKeyId: string; secretAccessKey: string; region: string } | null> {
  const workspace = await getWorkspace(workspaceId);
  if (!workspace || !workspace.aws_access_key_enc || !workspace.aws_secret_key_enc) {
    return null;
  }
  try {
    const accessKeyId = decrypt(workspace.aws_access_key_enc, config.credentials.encryptionKey);
    const secretAccessKey = decrypt(workspace.aws_secret_key_enc, config.credentials.encryptionKey);
    return {
      accessKeyId,
      secretAccessKey,
      region: workspace.aws_region || config.s3.defaultRegion,
    };
  } catch (err: any) {
    return null;
  }
}

/**
 * Apply the same visibility model used by /api/buckets:
 *  - admin: all
 *  - non-admin with explicit assignments: only those buckets
 *  - non-admin without assignments, but assignments exist somewhere: empty
 *  - non-admin and zero assignments anywhere: empty in production (default-deny);
 *    permissive in development only when explicitly enabled.
 */
async function filterByVisibility<T extends { name?: string }>(
  workspaceId: number,
  user: NonNullable<AuthRequest['user']>,
  buckets: T[]
): Promise<T[]> {
  if (user.role === 'admin') return buckets;

  const allowed = await getAllowedBucketsForUser(workspaceId, user.sub);
  if (Array.isArray(allowed) && allowed.length > 0) {
    return buckets.filter((b) => b.name && allowed.includes(b.name));
  }

  const assignmentCount = await totalBucketAssignments(workspaceId);
  if (assignmentCount > 0) return [];

  if (config.isProd) return [];
  return buckets;
}

router.get(
  '/buckets',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    const creds = await getWorkspaceCreds(req.user.workspaceId);
    if (!creds) throw new AppError('workspace_not_configured', 400, 'Workspace AWS credentials not configured');
    const all = await getAllBucketsWithMetrics(req.user.workspaceId, creds);
    const visible = await filterByVisibility(req.user.workspaceId, req.user, all);
    res.json(visible);
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
      const allowed = await getAllowedBucketsForUser(req.user.workspaceId, req.user.sub);
      if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(bucketName)) {
        throw new AppError('forbidden_bucket', 403);
      }
      if (!Array.isArray(allowed) || allowed.length === 0) {
        const assignmentCount = await totalBucketAssignments(req.user.workspaceId);
        if (assignmentCount > 0) throw new AppError('forbidden_bucket', 403);
        if (config.isProd) throw new AppError('forbidden_bucket', 403);
      }
    }

    const creds = await getWorkspaceCreds(req.user.workspaceId);
    if (!creds) throw new AppError('workspace_not_configured', 400, 'Workspace AWS credentials not configured');
    const metrics = await getDetailedBucketMetrics(
      req.user.workspaceId,
      bucketName,
      creds
    );
    res.json(metrics);
  })
);

router.get(
  '/summary',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    const creds = await getWorkspaceCreds(req.user.workspaceId);
    if (!creds) throw new AppError('workspace_not_configured', 400, 'Workspace AWS credentials not configured');
    const all = await getAllBucketsWithMetrics(req.user.workspaceId, creds);
    const visible = await filterByVisibility(req.user.workspaceId, req.user, all);

    const totalStorage = visible.reduce((sum, b: any) => sum + (b.totalSize || 0), 0);
    const totalObjects = visible.reduce((sum, b: any) => sum + (b.objectCount || 0), 0);

    const detailedResults = await Promise.allSettled(
      visible.map((b: any) =>
        getDetailedBucketMetrics(req.user!.workspaceId, b.name, creds)
      )
    );

    const storageClassBreakdown: Record<string, { size: number; count: number }> = {};
    for (const r of detailedResults) {
      if (r.status !== 'fulfilled') continue;
      const value = r.value as any;
      for (const sc of value.storageClasses || []) {
        const key = typeof sc === 'string' ? sc : sc.name || 'unknown';
        if (!storageClassBreakdown[key]) storageClassBreakdown[key] = { size: 0, count: 0 };
        if (typeof sc === 'object' && sc.size) {
          storageClassBreakdown[key].size += sc.size;
          storageClassBreakdown[key].count += sc.count;
        }
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
      storageClassBreakdown: (Object.entries(storageClassBreakdown) as Array<[string, { size: number; count: number }]>).map(([name, data]) => ({
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
    const creds = await getWorkspaceCreds(req.user.workspaceId);
    let all = await getAllBucketsWithMetrics(req.user.workspaceId, creds || undefined);
    if (regions.length > 0) {
      const set = new Set(regions);
      all = all.filter((m: any) => m.location && set.has(m.location));
    }
    const visible = await filterByVisibility(req.user.workspaceId, req.user, all);
    res.json(visible);
  })
);

export default router;
