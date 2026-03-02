import express from 'express';
import { db } from './db';
import { authMiddleware, AuthRequest } from './middleware/authMiddleware';
import { getAllBucketsWithMetrics, getDetailedBucketMetrics } from './s3';
import { getAllowedBucketsForUser } from './db';

const router = express.Router();

// Get metrics for all buckets (summary)
router.get('/buckets', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    // Get all buckets with metrics
    const allMetrics = await getAllBucketsWithMetrics();

    // Filter by allowed buckets if not admin
    if (user.role !== 'admin') {
      const allowedBuckets = getAllowedBucketsForUser(user.sub);
      if (Array.isArray(allowedBuckets) && allowedBuckets.length > 0) {
        return res.json(allMetrics.filter(b => allowedBuckets.includes(b.name!)));
      } else {
        // Check if bucket assignments exist in the system
        const counts = db.prepare(`SELECT (SELECT COUNT(*) FROM group_buckets) + (SELECT COUNT(*) FROM user_buckets) as total`).get() as any;
        const totalAssignments = counts ? Number(counts.total || 0) : 0;

        if (totalAssignments > 0) {
          // Assignments exist but user has none -> return empty
          return res.json([]);
        }
      }
    }

    res.json(allMetrics);
  } catch (err: any) {
    console.error('Failed to get bucket metrics:', err);
    res.status(500).json({ error: 'metrics_failed', detail: err.message });
  }
});

// Get detailed metrics for a specific bucket
router.get('/bucket/:name', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const bucketName = req.params.name;

    // Check bucket access for non-admin users
    if (user.role !== 'admin') {
      const allowedBuckets = getAllowedBucketsForUser(user.sub);
      if (Array.isArray(allowedBuckets) && allowedBuckets.length > 0) {
        if (!allowedBuckets.includes(bucketName)) {
          return res.status(403).json({ error: 'forbidden_bucket' });
        }
      }
    }

    const metrics = await getDetailedBucketMetrics(bucketName);
    res.json(metrics);
  } catch (err: any) {
    console.error('Failed to get detailed bucket metrics:', err);
    res.status(500).json({ error: 'metrics_failed', detail: err.message });
  }
});

// Get aggregated storage statistics
router.get('/summary', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const allMetrics = await getAllBucketsWithMetrics();

    // Filter by allowed buckets if not admin
    let metricsToUse = allMetrics;
    if (user.role !== 'admin') {
      const allowedBuckets = getAllowedBucketsForUser(user.sub);
      if (Array.isArray(allowedBuckets) && allowedBuckets.length > 0) {
        metricsToUse = allMetrics.filter(b => allowedBuckets.includes(b.name!));
      } else {
        const counts = db.prepare(`SELECT (SELECT COUNT(*) FROM group_buckets) + (SELECT COUNT(*) FROM user_buckets) as total`).get() as any;
        const totalAssignments = counts ? Number(counts.total || 0) : 0;

        if (totalAssignments > 0) {
          metricsToUse = [];
        }
      }
    }

    // Calculate totals
    const totalStorage = metricsToUse.reduce((sum, b) => sum + (b.totalSize || 0), 0);
    const totalObjects = metricsToUse.reduce((sum, b) => sum + (b.objectCount || 0), 0);
    const bucketCount = metricsToUse.length;

    // Storage class breakdown across all buckets
    const storageClassBreakdown: Record<string, { size: number; count: number }> = {};
    for (const metric of metricsToUse) {
      try {
        const detailed = await getDetailedBucketMetrics(metric.name!);
        for (const sc of detailed.storageClasses || []) {
          if (!storageClassBreakdown[sc.name]) {
            storageClassBreakdown[sc.name] = { size: 0, count: 0 };
          }
          storageClassBreakdown[sc.name].size += sc.size;
          storageClassBreakdown[sc.name].count += sc.count;
        }
      } catch (e) {
        // Skip if can't get detailed metrics
      }
    }

    res.json({
      totalStorage,
      totalStorageFormatted: formatBytes(totalStorage),
      totalObjects,
      bucketCount,
      buckets: metricsToUse.map(b => ({
        name: b.name,
        size: b.totalSize,
        sizeFormatted: b.sizeFormatted,
        objects: b.objectCount
      })),
      storageClassBreakdown: Object.entries(storageClassBreakdown).map(([name, data]) => ({
        name,
        ...data,
        sizeFormatted: formatBytes(data.size)
      }))
    });
  } catch (err: any) {
    console.error('Failed to get storage summary:', err);
    res.status(500).json({ error: 'summary_failed', detail: err.message });
  }
});

// Get bucket metrics filtered by regions
router.get('/buckets/regions', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    // Parse regions query parameter (comma-separated)
    const regionsParam = (req.query as any).regions as string | undefined;
    const regions = regionsParam ? regionsParam.split(',').map(r => r.trim()).filter(r => r) : [];
    // Get all metrics
    let allMetrics = await getAllBucketsWithMetrics();
    // Filter by requested regions if provided
    if (regions.length > 0) {
      const regionSet = new Set(regions);
      allMetrics = allMetrics.filter(m => m.location && regionSet.has(m.location));
    }
    // Apply user permissions (same as other routes)
    if (user.role !== 'admin') {
      const allowedBuckets = getAllowedBucketsForUser(user.sub);
      if (Array.isArray(allowedBuckets) && allowedBuckets.length > 0) {
        allMetrics = allMetrics.filter(b => allowedBuckets.includes(b.name!));
      } else {
        const counts = db.prepare(`SELECT (SELECT COUNT(*) FROM group_buckets) + (SELECT COUNT(*) FROM user_buckets) as total`).get() as any;
        const totalAssignments = counts ? Number(counts.total || 0) : 0;
        if (totalAssignments > 0) {
          allMetrics = [];
        }
      }
    }
    res.json(allMetrics);
  } catch (err: any) {
    console.error('Failed to get bucket metrics by regions:', err);
    res.status(500).json({ error: 'metrics_failed', detail: err.message });
  }
});
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export default router;
