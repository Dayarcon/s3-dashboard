import 'dotenv/config'
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { listBuckets, listBucketsWithRegion, listAtPrefix, getObjectContent, putObjectContent, deleteObject, 
  deleteObjects, 
  copyObject, 
  moveObject, 
  getObjectMetadata,
  createFolder  } from './s3';
import authRoutes from './auth';
import { ensureSuperAdminFromEnv, getAllowedBucketsForUser, insertAudit } from './db';
import { authMiddleware, AuthRequest } from './middleware/authMiddleware';
import groupRoutes from './groups';
import { permissionMiddleware } from './middleware/permissionMiddleware';
import userRoutes from './users';
import multer from 'multer';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { defaultClient, getClientForRegion, getBucketLocation } from './s3';
import auditRoutes from './audit';
import metricsRoutes from './metrics';
import { db } from './db';

dotenv.config();
const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '5mb' }));
const upload = multer({ storage: multer.memoryStorage() });
// ensure super admin
ensureSuperAdminFromEnv().catch(err => console.error('failed create admin', err));

// auth
app.use('/auth', authRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/users', userRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/metrics', metricsRoutes);

app.get('/api/health', async (req, res) => {
  try {
    // Check database
    db.prepare('SELECT 1').get();
    
    // Check S3 (optional - can be slow)
    // await listBuckets();
    
    res.json({ 
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected'
    });
  } catch (err: any) {
    res.status(503).json({ 
      status: 'unhealthy',
      error: err.message 
    });
  }
});

// List unique regions from all accessible buckets
app.get('/api/regions', authMiddleware, async (req, res) => {
  try {
    const buckets = await listBucketsWithRegion();
    const regions = [...new Set(buckets.map(b => b.region).filter(Boolean))].sort();
    // Also return all available AWS regions for reference
    const allAwsRegions = [
      'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
      'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-central-2', 'eu-north-1', 'eu-south-1', 'eu-south-2',
      'ap-south-1', 'ap-south-2', 'ap-southeast-1', 'ap-southeast-2', 'ap-southeast-3', 'ap-southeast-4', 'ap-southeast-5',
      'ap-northeast-1', 'ap-northeast-2', 'ap-northeast-3',
      'ca-central-1', 'ca-west-1',
      'sa-east-1',
      'me-central-1', 'me-south-1',
      'af-south-1',
      'il-central-1'
    ];
    res.json({ regions, allAwsRegions });
  } catch (err) { console.error(err); res.status(500).json({ error: 'list_regions_failed' }); }
});

// Listing buckets: require authentication but allow visibility based on explicit bucket assignments.
// We avoid requiring the generic 'bucket' permission here so that assigning a bucket to a group/user
// is enough to make it visible to them.
// Supports optional ?regions=us-east-1,ap-south-1 query param to filter by regions.
app.get('/api/buckets', authMiddleware, async (req, res) => {
  try {
    const buckets = await listBucketsWithRegion();

    // Apply region filter if provided
    const regionsParam = req.query.regions ? String(req.query.regions) : '';
    const regionFilter = regionsParam ? regionsParam.split(',').map(r => r.trim()).filter(Boolean) : [];
    let visible = regionFilter.length > 0
      ? buckets.filter(b => regionFilter.includes(b.region))
      : buckets;

    // If bucket assignments exist in the system, enforce strict visibility:
    // - if user has allowed buckets -> return only those
    // - if user has no allowed buckets -> return empty list
    // If NO assignments exist at all in the DB, fall back to returning all buckets.
    try {
      const userReq = req as AuthRequest;
      if (userReq.user) {
        // If the user is admin, bypass assignment filtering and return all buckets
        if (userReq.user.role === 'admin') {
          return res.json(visible);
        }

        const allowed = getAllowedBucketsForUser(userReq.user.sub);

        const counts = db.prepare(`SELECT (SELECT COUNT(*) FROM group_buckets) + (SELECT COUNT(*) FROM user_buckets) as total`).get() as any;
        const totalAssignments = counts ? Number(counts.total || 0) : 0;

        if (Array.isArray(allowed) && allowed.length > 0) {
          const filtered = visible.filter((b: any) => allowed.includes(b.name));
          return res.json(filtered);
        }

        if (totalAssignments > 0) {
          // assignments exist but user has none -> return empty list (no visibility)
          return res.json([]);
        }
        // else: no assignments exist in system -> fallthrough and return all buckets
      }
    } catch (e) {
      console.error('failed to filter buckets by assignment', e);
    }

    res.json(visible);
  } catch (err) { console.error(err); res.status(500).json({ error: 'list_buckets_failed' }); }
});

// helper to ensure bucket belongs to user's allowed buckets (if any assignments exist)
function ensureBucketAllowed(req: AuthRequest, res: express.Response, bucket: string) {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  if (req.user.role === 'admin') return true;
  const allowed = getAllowedBucketsForUser(req.user.sub);
  if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(bucket)) {
    res.status(403).json({ error: 'forbidden_bucket' });
    return false;
  }
  return true;
}

app.get('/api/list', authMiddleware, async (req, res) => {
  try {
    const bucket = String(req.query.bucket || '');
    const prefix = String(req.query.prefix || '');
    if (!bucket) return res.status(400).json({ error: 'missing_bucket' });
    // ensure the requesting user is allowed to view this bucket
    if (!ensureBucketAllowed(req as AuthRequest, res, bucket)) return;
    const data = await listAtPrefix(bucket, prefix);
    try { insertAudit((req as AuthRequest).user?.sub || null, 'list', `bucket:${bucket}`, { prefix }); } catch (e) {}
    res.json(data);
  } catch (err) { console.error(err); res.status(500).json({ error: 'list_failed' }); }
});

// Get file - now supports streaming for all file types (images, videos, pdf, etc.)
app.get('/api/file', authMiddleware, async (req, res) => {
  try {
    const bucket = String(req.query.bucket || '');
    const key = String(req.query.key || '');
    if (!bucket || !key) return res.status(400).json({ error: 'missing_params' });
    if (!ensureBucketAllowed(req as AuthRequest, res, bucket)) return;

    const bucketRegion = await getBucketLocation(bucket);
    const s3Client = getClientForRegion(bucketRegion);

    // Get object metadata first
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
    const headCmd = new HeadObjectCommand({ Bucket: bucket, Key: key });
    const headRes = await s3Client.send(headCmd);

    const contentType = headRes.ContentType || 'application/octet-stream';
    const contentLength = headRes.ContentLength || 0;

    // Set appropriate headers for streaming
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', contentLength.toString());
    res.setHeader('Content-Disposition', `inline; filename="${key.split('/').pop()}"`);

    // Stream the file with optional Range support
    const rangeHeader = req.headers.range as string | undefined;
    const getObjectParams: any = { Bucket: bucket, Key: key };
    if (rangeHeader) {
      getObjectParams.Range = rangeHeader;
    }
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const cmd = new GetObjectCommand(getObjectParams);
    const response = await s3Client.send(cmd);

    // Set status and headers for partial content if range requested
    if (rangeHeader) {
      res.status(206);
      const metadata: any = response.$metadata;
      const contentRange = (response as any).ContentRange || metadata?.httpHeaders?.['content-range'];
      if (contentRange) {
        res.setHeader('Content-Range', contentRange);
      }
    }

    // Stream the body to response
    if (response.Body) {
      const stream = response.Body as any;
      for await (const chunk of stream) {
        res.write(chunk);
      }
      res.end();
    }

    try { insertAudit((req as AuthRequest).user?.sub || null, 'get_file', `bucket:${bucket}`, { key }); } catch (e) {}
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: 'get_failed', detail: err.message });
  }
});

// Get file download URL (for direct download)
app.get('/api/file/download', authMiddleware, async (req, res) => {
  try {
    const bucket = String(req.query.bucket || '');
    const key = String(req.query.key || '');
    if (!bucket || !key) return res.status(400).json({ error: 'missing_params' });
    if (!ensureBucketAllowed(req as AuthRequest, res, bucket)) return;

    const bucketRegion = await getBucketLocation(bucket);
    const s3Client = getClientForRegion(bucketRegion);

    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
    const response = await s3Client.send(cmd);

    const contentType = response.ContentType || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${key.split('/').pop()}"`);

    if (response.Body) {
      const stream = response.Body as any;
      for await (const chunk of stream) {
        res.write(chunk);
      }
      res.end();
    }

    try { insertAudit((req as AuthRequest).user?.sub || null, 'download_file', `bucket:${bucket}`, { key }); } catch (e) {}
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: 'download_failed', detail: err.message });
  }
});

app.put('/api/file', authMiddleware, permissionMiddleware('file', 'write'), async (req, res) => {
  try {
    const { bucket, key, content } = req.body;
    if (!bucket || !key) return res.status(400).json({ error: 'missing_params' });
    if (!ensureBucketAllowed(req as AuthRequest, res, bucket)) return;
    await putObjectContent(bucket, key, content);
    try { insertAudit((req as AuthRequest).user?.sub || null, 'put_file', `bucket:${bucket}`, { key }); } catch (e) {}
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'put_failed' }); }
});

app.delete('/api/file', authMiddleware, permissionMiddleware('file', 'write'), async (req, res) => {
  try {
    const { bucket, key } = req.body;
    if (!bucket || !key) return res.status(400).json({ error: 'missing_params' });
    if (!ensureBucketAllowed(req as AuthRequest, res, bucket)) return;
    await deleteObject(bucket, key);
    try { insertAudit((req as AuthRequest).user?.sub || null, 'delete_file', `bucket:${bucket}`, { key }); } catch (e) {}
    res.json({ ok: true });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: 'delete_failed', detail: err.message });
  }
});

// Delete multiple files
app.post('/api/files/delete', authMiddleware, permissionMiddleware('file', 'write'), async (req, res) => {
  try {
    const { bucket, keys } = req.body;
    if (!bucket || !Array.isArray(keys) || keys.length === 0) {
      return res.status(400).json({ error: 'missing_params' });
    }
    if (!ensureBucketAllowed(req as AuthRequest, res, bucket)) return;
    const result = await deleteObjects(bucket, keys);
    try { insertAudit((req as AuthRequest).user?.sub || null, 'bulk_delete', `bucket:${bucket}`, { keys }); } catch (e) {}
    res.json(result);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: 'bulk_delete_failed', detail: err.message });
  }
});

// Copy file
app.post('/api/file/copy', authMiddleware, permissionMiddleware('file', 'write'), async (req, res) => {
  try {
    const { bucket, sourceKey, destKey } = req.body;
    if (!bucket || !sourceKey || !destKey) {
      return res.status(400).json({ error: 'missing_params' });
    }
    if (!ensureBucketAllowed(req as AuthRequest, res, bucket)) return;
    await copyObject(bucket, sourceKey, destKey);
    try { insertAudit((req as AuthRequest).user?.sub || null, 'copy_file', `bucket:${bucket}`, { sourceKey, destKey }); } catch (e) {}
    res.json({ ok: true });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: 'copy_failed', detail: err.message });
  }
});

// Move/Rename file
app.post('/api/file/move', authMiddleware, permissionMiddleware('file', 'write'), async (req, res) => {
  try {
    const { bucket, sourceKey, destKey } = req.body;
    if (!bucket || !sourceKey || !destKey) {
      return res.status(400).json({ error: 'missing_params' });
    }
    if (!ensureBucketAllowed(req as AuthRequest, res, bucket)) return;
    await moveObject(bucket, sourceKey, destKey);
    try { insertAudit((req as AuthRequest).user?.sub || null, 'move_file', `bucket:${bucket}`, { sourceKey, destKey }); } catch (e) {}
    res.json({ ok: true });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: 'move_failed', detail: err.message });
  }
});

// Get file metadata
app.get('/api/file/info', authMiddleware, async (req, res) => {
  try {
    const bucket = String(req.query.bucket || '');
    const key = String(req.query.key || '');
    if (!bucket || !key) return res.status(400).json({ error: 'missing_params' });
    if (!ensureBucketAllowed(req as AuthRequest, res, bucket)) return;
    const metadata = await getObjectMetadata(bucket, key);
    try { insertAudit((req as AuthRequest).user?.sub || null, 'file_info', `bucket:${bucket}`, { key }); } catch (e) {}
    res.json(metadata);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: 'get_metadata_failed', detail: err.message });
  }
});

// File upload endpoint
app.post('/api/file/upload', 
  authMiddleware, 
  permissionMiddleware('file', 'write'),
  upload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'no_file_uploaded' });
      
      const { bucket, key } = req.body;
      if (!bucket || !key) return res.status(400).json({ error: 'missing_params' });
      if (!ensureBucketAllowed(req as AuthRequest, res, bucket)) return;

      const bucketRegion = await getBucketLocation(bucket);
      const s3Client = getClientForRegion(bucketRegion);
      const cmd = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype
      });
      await s3Client.send(cmd);
      
      res.json({ ok: true, key, size: req.file.size });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: 'upload_failed', detail: err.message });
    }
  }
);

// Create folder endpoint
app.post('/api/folder/create', 
  authMiddleware, 
  permissionMiddleware('folder', 'write'),
  async (req, res) => {
    try {
      const { bucket, folderPath } = req.body;
      if (!bucket || !folderPath) {
        return res.status(400).json({ error: 'missing_params' });
      }
      if (!ensureBucketAllowed(req as AuthRequest, res, bucket)) return;
      await createFolder(bucket, folderPath);
      try { insertAudit((req as AuthRequest).user?.sub || null, 'create_folder', `bucket:${bucket}`, { folderPath }); } catch (e) {}
      res.json({ ok: true, folderPath });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: 'create_folder_failed', detail: err.message });
    }
  }
);

// Delete folder endpoint
app.delete('/api/folder',
  authMiddleware,
  permissionMiddleware('folder', 'write'),
  async (req, res) => {
    try {
      const { bucket, folderPath } = req.body;
      if (!bucket || !folderPath) {
        return res.status(400).json({ error: 'missing_params' });
      }
      if (!ensureBucketAllowed(req as AuthRequest, res, bucket)) return;
      // Ensure folder path ends with '/' for deletion
      const folderKey = folderPath.endsWith('/') ? folderPath : `${folderPath}/`;
      await deleteObject(bucket, folderKey);
      res.json({ ok: true });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: 'delete_folder_failed', detail: err.message });
    }
  }
);

// In-memory store for upload progress (in production, use Redis)
const uploadProgressStore = new Map<string, {
  progress: number;
  uploadedBytes: number;
  totalBytes: number;
  status: 'pending' | 'uploading' | 'completed' | 'error';
  uploadId?: string;
  parts?: any[];
}>();

// Initiate multipart upload
app.post('/api/upload/initiate', authMiddleware, async (req, res) => {
  try {
    const { bucket, key, contentType, fileSize } = req.body;
    if (!bucket || !key) return res.status(400).json({ error: 'missing_params' });
    if (!ensureBucketAllowed(req as AuthRequest, res, bucket)) return;

    const bucketRegion = await getBucketLocation(bucket);
    const s3Client = getClientForRegion(bucketRegion);

    const { CreateMultipartUploadCommand } = await import('@aws-sdk/client-s3');
    const cmd = new CreateMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType || 'application/octet-stream'
    });
    const response = await s3Client.send(cmd);

    const uploadId = response.UploadId!;
    const progressKey = `${bucket}:${key}:${uploadId}`;

    uploadProgressStore.set(progressKey, {
      progress: 0,
      uploadedBytes: 0,
      totalBytes: fileSize || 0,
      status: 'pending',
      uploadId,
      parts: []
    });

    res.json({ ok: true, uploadId, key, bucket });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: 'initiate_upload_failed', detail: err.message });
  }
});

// Upload a single part
app.post('/api/upload/part', authMiddleware, async (req, res) => {
  try {
    const { bucket, key, uploadId, partNumber, data } = req.body;
    if (!bucket || !key || !uploadId || !partNumber || !data) {
      return res.status(400).json({ error: 'missing_params' });
    }
    if (!ensureBucketAllowed(req as AuthRequest, res, bucket)) return;

    const bucketRegion = await getBucketLocation(bucket);
    const s3Client = getClientForRegion(bucketRegion);

    const { UploadPartCommand } = await import('@aws-sdk/client-s3');
    const partBuffer = Buffer.from(data, 'base64');
    const cmd = new UploadPartCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
      Body: partBuffer
    });
    const response = await s3Client.send(cmd);

    const progressKey = `${bucket}:${key}:${uploadId}`;
    const progress = uploadProgressStore.get(progressKey);
    if (progress) {
      progress.parts = progress.parts || [];
      progress.parts.push({ PartNumber: partNumber, ETag: response.ETag });
      // Update progress metrics
      const partSize = partBuffer.byteLength;
      progress.uploadedBytes = (progress.uploadedBytes || 0) + partSize;
      if (progress.totalBytes && progress.totalBytes > 0) {
        const pct = Math.round((progress.uploadedBytes / progress.totalBytes) * 100);
        progress.progress = Math.min(100, Math.max(0, pct));
      } else {
        progress.progress = 0;
      }
      progress.status = 'uploading';
      uploadProgressStore.set(progressKey, progress);
    }

    res.json({ ok: true, partNumber, etag: response.ETag });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: 'upload_part_failed', detail: err.message });
  }
});

// Complete multipart upload
app.post('/api/upload/complete', authMiddleware, async (req, res) => {
  try {
    const { bucket, key, uploadId, parts } = req.body;
    if (!bucket || !key || !uploadId || !parts) {
      return res.status(400).json({ error: 'missing_params' });
    }
    if (!ensureBucketAllowed(req as AuthRequest, res, bucket)) return;

    const bucketRegion = await getBucketLocation(bucket);
    const s3Client = getClientForRegion(bucketRegion);

    const { CompleteMultipartUploadCommand } = await import('@aws-sdk/client-s3');
    const cmd = new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts.sort((a: any, b: any) => a.PartNumber - b.PartNumber) }
    });
    await s3Client.send(cmd);

    const progressKey = `${bucket}:${key}:${uploadId}`;
    uploadProgressStore.set(progressKey, {
      progress: 100,
      uploadedBytes: 0,
      totalBytes: 0,
      status: 'completed'
    });

    // Clean up after 30 seconds
    setTimeout(() => uploadProgressStore.delete(progressKey), 30000);

    try { insertAudit((req as AuthRequest).user?.sub || null, 'upload_file', `bucket:${bucket}`, { key }); } catch (e) {}
    res.json({ ok: true, key });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: 'complete_upload_failed', detail: err.message });
  }
});

// Abort multipart upload
app.post('/api/upload/abort', authMiddleware, async (req, res) => {
  try {
    const { bucket, key, uploadId } = req.body;
    if (!bucket || !key || !uploadId) {
      return res.status(400).json({ error: 'missing_params' });
    }

    const bucketRegion = await getBucketLocation(bucket);
    const s3Client = getClientForRegion(bucketRegion);

    const { AbortMultipartUploadCommand } = await import('@aws-sdk/client-s3');
    const cmd = new AbortMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId
    });
    await s3Client.send(cmd);

    const progressKey = `${bucket}:${key}:${uploadId}`;
    uploadProgressStore.delete(progressKey);

    res.json({ ok: true });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: 'abort_upload_failed', detail: err.message });
  }
});

// Get upload progress
app.get('/api/upload/progress/:uploadId', authMiddleware, async (req, res) => {
  try {
    const { uploadId } = req.params;
    const { bucket, key } = req.query;

    if (!bucket || !key) {
      return res.status(400).json({ error: 'missing_params' });
    }

    const progressKey = `${bucket}:${key}:${uploadId}`;
    const progress = uploadProgressStore.get(progressKey);

    if (!progress) {
      return res.status(404).json({ error: 'upload_not_found' });
    }

    res.json(progress);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: 'get_progress_failed', detail: err.message });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Backend listening on ${PORT}`));
