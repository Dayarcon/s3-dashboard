// backend/src/index.ts
//
// Entry point. Order matters here:
//   1. Load config (validates env, fails fast on missing JWT_SECRET / CORS).
//   2. Mount logger + security middleware.
//   3. Mount auth and resource routes.
//   4. Mount error handler last.

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import bodyParser from 'body-parser';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

import { config } from './config';
import { logger, httpLogger } from './logger';
import { errorHandler, notFoundHandler, AppError, asyncHandler } from './errors';
import { validate } from './validate';

import {
  listBucketsWithRegion,
  listAtPrefix,
  putObjectContent,
  deleteObject,
  deleteObjects,
  copyObject,
  moveObject,
  getObjectMetadata,
  createFolder,
  getClientForWorkspace,
  getBucketLocation,
} from './s3';

import authRoutes from './auth';
import groupRoutes from './groups';
import userRoutes from './users';
import auditRoutes from './audit';
import metricsRoutes from './metrics';
import {
  getAllowedBucketsForUser,
  insertAudit,
  totalBucketAssignments,
  runMigrations,
  getWorkspace,
  pool,
} from './db';
import { decrypt } from './crypto';
import { authMiddleware, AuthRequest } from './middleware/authMiddleware';
import { permissionMiddleware } from './middleware/permissionMiddleware';
import { startLockoutGc } from './loginLockout';
import {
  createSession,
  getSession,
  markAborted,
  markCompleted,
  recordPart,
  cleanupStale as cleanupStaleUploads,
} from './uploadSessions';

const app = express();

// --- platform plumbing ------------------------------------------------------

// Express trust-proxy enables req.ip to come from X-Forwarded-For when sitting
// behind a reverse proxy (nginx, ALB, etc). Single-hop is safe for typical setups.
app.set('trust proxy', 1);

app.use(httpLogger);
app.use(helmet());

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow same-origin / curl / server-side requests with no Origin header.
      if (!origin) return cb(null, true);
      if (config.cors.allowlist.includes(origin)) return cb(null, true);
      return cb(new Error(`origin_not_allowed:${origin}`));
    },
    credentials: false,
  })
);

app.use(bodyParser.json({ limit: config.uploads.bodyJsonLimit }));

// Multer with file-size cap. Used by the single-shot upload endpoint.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.uploads.maxFileBytes },
});

// --- rate limiters ----------------------------------------------------------

const globalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
});

const loginLimiter = rateLimit({
  windowMs: config.rateLimit.loginWindowMs,
  max: config.rateLimit.loginMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_login_attempts' },
});

app.use(globalLimiter);
app.use('/auth/login', loginLimiter);

// --- helpers ----------------------------------------------------------------

async function getWorkspaceCreds(workspaceId: number) {
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
  } catch {
    return null;
  }
}

// --- startup tasks ----------------------------------------------------------

// Run database migrations
runMigrations().catch((err) => {
  logger.error({ err }, 'failed_to_run_migrations');
  process.exit(1);
});

// Multi-tenant: no super admin from env
// ensureSuperAdminFromEnv().catch((err) =>
//   logger.error({ err }, 'failed_to_create_super_admin')
// );
startLockoutGc();

// Periodically clean up stale upload sessions (every 30 min, drop sessions older than 24h).
const uploadCleanup = setInterval(
  () => cleanupStaleUploads(24 * 60 * 60_000),
  30 * 60_000
);
if (typeof uploadCleanup.unref === 'function') uploadCleanup.unref();

// --- routes -----------------------------------------------------------------

app.use('/auth', authRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/users', userRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/metrics', metricsRoutes);

app.get(
  '/api/health',
  asyncHandler(async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        database: 'connected',
      });
    } catch (err: any) {
      logger.error({ err }, 'health_check_failed');
      res.status(503).json({ status: 'unhealthy' });
    }
  })
);

// /api/ready also checks S3 reachability — slower, used by orchestrators.
app.get(
  '/api/ready',
  asyncHandler(async (_req, res) => {
    await pool.query('SELECT 1');
    // Note: /api/ready skips S3 check as it requires auth and workspace context
    res.json({ status: 'ready' });
  })
);

// --- regions ---------------------------------------------------------------

app.get(
  '/api/regions',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    const creds = await getWorkspaceCreds(req.user.workspaceId);
    if (!creds) throw new AppError('workspace_not_configured', 400, 'Workspace AWS credentials not configured');
    const buckets = await listBucketsWithRegion(req.user.workspaceId, creds);
    const regions = [...new Set(buckets.map((b) => b.region).filter(Boolean))].sort();
    const allAwsRegions = [
      'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
      'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-central-2', 'eu-north-1', 'eu-south-1', 'eu-south-2',
      'ap-south-1', 'ap-south-2', 'ap-southeast-1', 'ap-southeast-2', 'ap-southeast-3', 'ap-southeast-4', 'ap-southeast-5',
      'ap-northeast-1', 'ap-northeast-2', 'ap-northeast-3',
      'ca-central-1', 'ca-west-1',
      'sa-east-1',
      'me-central-1', 'me-south-1',
      'af-south-1',
      'il-central-1',
    ];
    res.json({ regions, allAwsRegions });
  })
);

// --- bucket visibility helper ----------------------------------------------

/**
 * Throws AppError if the given user is not allowed to see this bucket.
 * Centralizes the rule used in /api/buckets and per-object endpoints.
 */
async function ensureBucketAllowed(req: AuthRequest, bucket: string) {
  if (!req.user) throw new AppError('unauthorized', 401);
  if (req.user.role === 'admin') return;

  const allowed = await getAllowedBucketsForUser(req.user.workspaceId, req.user.sub);
  if (Array.isArray(allowed) && allowed.length > 0) {
    if (!allowed.includes(bucket)) throw new AppError('forbidden_bucket', 403);
    return;
  }

  // No assignments for this user. If any assignments exist anywhere, deny.
  // If zero assignments exist anywhere: deny in production (default-deny),
  // permissive in dev so a bare bootstrap install is usable.
  const total = await totalBucketAssignments(req.user.workspaceId);
  if (total > 0 || config.isProd) {
    throw new AppError('forbidden_bucket', 403);
  }
}

// --- buckets ----------------------------------------------------------------

const bucketsQuerySchema = z.object({ regions: z.string().optional() });

app.get(
  '/api/buckets',
  authMiddleware,
  validate(bucketsQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    const creds = await getWorkspaceCreds(req.user.workspaceId);
    if (!creds) throw new AppError('workspace_not_configured', 400, 'Workspace AWS credentials not configured');
    const buckets = await listBucketsWithRegion(req.user.workspaceId, creds);
    const regionsParam = (req.query as any).regions as string | undefined;
    const regionFilter = regionsParam
      ? regionsParam.split(',').map((r) => r.trim()).filter(Boolean)
      : [];
    let visible = regionFilter.length > 0
      ? buckets.filter((b) => regionFilter.includes(b.region!))
      : buckets;

    if (req.user.role === 'admin') return res.json(visible);

    const allowed = await getAllowedBucketsForUser(req.user.workspaceId, req.user.sub);
    if (Array.isArray(allowed) && allowed.length > 0) {
      return res.json(visible.filter((b: any) => allowed.includes(b.name)));
    }

    const total = await totalBucketAssignments(req.user.workspaceId);
    if (total > 0) return res.json([]);
    if (config.isProd) return res.json([]);
    res.json(visible);
  })
);

// --- list & file ops --------------------------------------------------------

const listSchema = z.object({
  bucket: z.string().min(1).max(255),
  prefix: z.string().max(2048).optional().default(''),
  continuationToken: z.string().max(4096).optional(),
  maxKeys: z.coerce.number().int().min(1).max(1000).optional(),
});

app.get(
  '/api/list',
  authMiddleware,
  validate(listSchema, 'query'),
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    const q = req.query as unknown as z.infer<typeof listSchema>;
    await ensureBucketAllowed(req, q.bucket);
    const creds = await getWorkspaceCreds(req.user.workspaceId);
    if (!creds) throw new AppError('workspace_not_configured', 400, 'Workspace AWS credentials not configured');
    const data = await listAtPrefix(req.user.workspaceId, q.bucket, creds, q.prefix, {
      continuationToken: q.continuationToken,
      maxKeys: q.maxKeys,
    });
    await insertAudit(req.user.workspaceId, req.user.sub, 'list', `bucket:${q.bucket}`, { prefix: q.prefix });
    res.json(data);
  })
);

const keyQuerySchema = z.object({
  bucket: z.string().min(1).max(255),
  key: z.string().min(1).max(2048),
});

app.get(
  '/api/file',
  authMiddleware,
  validate(keyQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    const { bucket, key } = req.query as unknown as z.infer<typeof keyQuerySchema>;
    await ensureBucketAllowed(req, bucket);

    const creds = await getWorkspaceCreds(req.user.workspaceId);
    if (!creds) throw new AppError('workspace_not_configured', 400, 'Workspace AWS credentials not configured');
    const region = await getBucketLocation(req.user.workspaceId, bucket, creds);
    const s3Client = getClientForWorkspace(req.user.workspaceId, creds, region);

    const { HeadObjectCommand, GetObjectCommand } = await import('@aws-sdk/client-s3');
    const headRes = await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    const contentType = headRes.ContentType || 'application/octet-stream';
    const contentLength = headRes.ContentLength || 0;

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', contentLength.toString());
    res.setHeader('Content-Disposition', `inline; filename="${key.split('/').pop()}"`);

    const rangeHeader = req.headers.range as string | undefined;
    const params: any = { Bucket: bucket, Key: key };
    if (rangeHeader) params.Range = rangeHeader;
    const response = await s3Client.send(new GetObjectCommand(params));

    if (rangeHeader) {
      res.status(206);
      const metadata: any = response.$metadata;
      const contentRange =
        (response as any).ContentRange || metadata?.httpHeaders?.['content-range'];
      if (contentRange) res.setHeader('Content-Range', contentRange);
    }

    if (response.Body) {
      const stream = response.Body as any;
      for await (const chunk of stream) res.write(chunk);
      res.end();
    }

    await insertAudit(req.user.workspaceId, req.user.sub, 'get_file', `bucket:${bucket}`, { key });
  })
);

app.get(
  '/api/file/download',
  authMiddleware,
  validate(keyQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    const { bucket, key } = req.query as unknown as z.infer<typeof keyQuerySchema>;
    await ensureBucketAllowed(req, bucket);

    const creds = await getWorkspaceCreds(req.user.workspaceId);
    if (!creds) throw new AppError('workspace_not_configured', 400, 'Workspace AWS credentials not configured');
    const region = await getBucketLocation(req.user.workspaceId, bucket, creds);
    const s3Client = getClientForWorkspace(req.user.workspaceId, creds, region);
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const response = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));

    res.setHeader('Content-Type', response.ContentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${key.split('/').pop()}"`);

    if (response.Body) {
      const stream = response.Body as any;
      for await (const chunk of stream) res.write(chunk);
      res.end();
    }

    await insertAudit(req.user.workspaceId, req.user.sub, 'download_file', `bucket:${bucket}`, { key });
  })
);

const putFileSchema = z.object({
  bucket: z.string().min(1).max(255),
  key: z.string().min(1).max(2048),
  content: z.string(),
});

app.put(
  '/api/file',
  authMiddleware,
  permissionMiddleware('file', 'write'),
  validate(putFileSchema),
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    const { bucket, key, content } = req.body as z.infer<typeof putFileSchema>;
    await ensureBucketAllowed(req, bucket);
    const creds = await getWorkspaceCreds(req.user.workspaceId);
    if (!creds) throw new AppError('workspace_not_configured', 400, 'Workspace AWS credentials not configured');
    await putObjectContent(req.user.workspaceId, bucket, key, content, creds);
    await insertAudit(req.user.workspaceId, req.user.sub, 'put_file', `bucket:${bucket}`, { key });
    res.json({ ok: true });
  })
);

const deleteFileSchema = z.object({
  bucket: z.string().min(1).max(255),
  key: z.string().min(1).max(2048),
});

app.delete(
  '/api/file',
  authMiddleware,
  permissionMiddleware('file', 'write'),
  validate(deleteFileSchema),
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    const { bucket, key } = req.body as z.infer<typeof deleteFileSchema>;
    await ensureBucketAllowed(req, bucket);
    const creds = await getWorkspaceCreds(req.user.workspaceId);
    if (!creds) throw new AppError('workspace_not_configured', 400, 'Workspace AWS credentials not configured');
    await deleteObject(req.user.workspaceId, bucket, key, creds);
    await insertAudit(req.user.workspaceId, req.user.sub, 'delete_file', `bucket:${bucket}`, { key });
    res.json({ ok: true });
  })
);

const bulkDeleteSchema = z.object({
  bucket: z.string().min(1).max(255),
  keys: z.array(z.string().min(1).max(2048)).min(1).max(1000),
});

app.post(
  '/api/files/delete',
  authMiddleware,
  permissionMiddleware('file', 'write'),
  validate(bulkDeleteSchema),
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    const { bucket, keys } = req.body as z.infer<typeof bulkDeleteSchema>;
    await ensureBucketAllowed(req, bucket);
    const creds = await getWorkspaceCreds(req.user.workspaceId);
    if (!creds) throw new AppError('workspace_not_configured', 400, 'Workspace AWS credentials not configured');
    const result = await deleteObjects(req.user.workspaceId, bucket, keys, creds);
    await insertAudit(req.user.workspaceId, req.user.sub, 'bulk_delete', `bucket:${bucket}`, { keys });
    res.json(result);
  })
);

const copyMoveSchema = z.object({
  bucket: z.string().min(1).max(255),
  sourceKey: z.string().min(1).max(2048),
  destKey: z.string().min(1).max(2048),
});

app.post(
  '/api/file/copy',
  authMiddleware,
  permissionMiddleware('file', 'write'),
  validate(copyMoveSchema),
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    const { bucket, sourceKey, destKey } = req.body as z.infer<typeof copyMoveSchema>;
    await ensureBucketAllowed(req, bucket);
    const creds = await getWorkspaceCreds(req.user.workspaceId);
    if (!creds) throw new AppError('workspace_not_configured', 400, 'Workspace AWS credentials not configured');
    await copyObject(req.user.workspaceId, bucket, sourceKey, destKey, creds);
    await insertAudit(req.user.workspaceId, req.user.sub, 'copy_file', `bucket:${bucket}`, { sourceKey, destKey });
    res.json({ ok: true });
  })
);

app.post(
  '/api/file/move',
  authMiddleware,
  permissionMiddleware('file', 'write'),
  validate(copyMoveSchema),
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    const { bucket, sourceKey, destKey } = req.body as z.infer<typeof copyMoveSchema>;
    await ensureBucketAllowed(req, bucket);
    const creds = await getWorkspaceCreds(req.user.workspaceId);
    if (!creds) throw new AppError('workspace_not_configured', 400, 'Workspace AWS credentials not configured');
    await moveObject(req.user.workspaceId, bucket, sourceKey, destKey, creds);
    await insertAudit(req.user.workspaceId, req.user.sub, 'move_file', `bucket:${bucket}`, { sourceKey, destKey });
    res.json({ ok: true });
  })
);

app.get(
  '/api/file/info',
  authMiddleware,
  validate(keyQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    const { bucket, key } = req.query as unknown as z.infer<typeof keyQuerySchema>;
    await ensureBucketAllowed(req, bucket);
    const creds = await getWorkspaceCreds(req.user.workspaceId);
    if (!creds) throw new AppError('workspace_not_configured', 400, 'Workspace AWS credentials not configured');
    const metadata = await getObjectMetadata(req.user.workspaceId, bucket, key, creds);
    await insertAudit(req.user.workspaceId, req.user.sub, 'file_info', `bucket:${bucket}`, { key });
    res.json(metadata);
  })
);

// Single-shot upload endpoint (size-capped).
app.post(
  '/api/file/upload',
  authMiddleware,
  permissionMiddleware('file', 'write'),
  upload.single('file'),
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    if (!req.file) throw new AppError('no_file_uploaded', 400);
    const { bucket, key } = req.body as { bucket?: string; key?: string };
    if (!bucket || !key) throw new AppError('missing_params', 400);
    await ensureBucketAllowed(req, bucket);

    const creds = await getWorkspaceCreds(req.user.workspaceId);
    if (!creds) throw new AppError('workspace_not_configured', 400, 'Workspace AWS credentials not configured');
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const region = await getBucketLocation(req.user.workspaceId, bucket, creds);
    const s3Client = getClientForWorkspace(req.user.workspaceId, creds, region);
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      })
    );
    await insertAudit(req.user.workspaceId, req.user.sub, 'upload_file', `bucket:${bucket}`, { key });
    res.json({ ok: true, key, size: req.file.size });
  })
);

const folderSchema = z.object({
  bucket: z.string().min(1).max(255),
  folderPath: z.string().min(1).max(2048),
});

app.post(
  '/api/folder/create',
  authMiddleware,
  permissionMiddleware('folder', 'write'),
  validate(folderSchema),
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    const { bucket, folderPath } = req.body as z.infer<typeof folderSchema>;
    await ensureBucketAllowed(req, bucket);
    const creds = await getWorkspaceCreds(req.user.workspaceId);
    if (!creds) throw new AppError('workspace_not_configured', 400, 'Workspace AWS credentials not configured');
    await createFolder(req.user.workspaceId, bucket, folderPath, creds);
    await insertAudit(req.user.workspaceId, req.user.sub, 'create_folder', `bucket:${bucket}`, { folderPath });
    res.json({ ok: true, folderPath });
  })
);

app.delete(
  '/api/folder',
  authMiddleware,
  permissionMiddleware('folder', 'write'),
  validate(folderSchema),
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    const { bucket, folderPath } = req.body as z.infer<typeof folderSchema>;
    await ensureBucketAllowed(req, bucket);
    const creds = await getWorkspaceCreds(req.user.workspaceId);
    if (!creds) throw new AppError('workspace_not_configured', 400, 'Workspace AWS credentials not configured');
    const folderKey = folderPath.endsWith('/') ? folderPath : `${folderPath}/`;
    await deleteObject(req.user.workspaceId, bucket, folderKey, creds);
    await insertAudit(req.user.workspaceId, req.user.sub, 'delete_folder', `bucket:${bucket}`, { folderKey });
    res.json({ ok: true });
  })
);

// --- multipart uploads (persisted in SQLite) -------------------------------

const initiateSchema = z.object({
  bucket: z.string().min(1).max(255),
  key: z.string().min(1).max(2048),
  contentType: z.string().max(255).optional(),
  fileSize: z.number().int().nonnegative().optional(),
});

app.post(
  '/api/upload/initiate',
  authMiddleware,
  validate(initiateSchema),
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    const { bucket, key, contentType, fileSize } = req.body as z.infer<typeof initiateSchema>;
    await ensureBucketAllowed(req, bucket);

    const creds = await getWorkspaceCreds(req.user.workspaceId);
    if (!creds) throw new AppError('workspace_not_configured', 400, 'Workspace AWS credentials not configured');
    const region = await getBucketLocation(req.user.workspaceId, bucket, creds);
    const s3Client = getClientForWorkspace(req.user.workspaceId, creds, region);
    const { CreateMultipartUploadCommand } = await import('@aws-sdk/client-s3');
    const response = await s3Client.send(
      new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType || 'application/octet-stream',
      })
    );
    const uploadId = response.UploadId!;
    await createSession({
      uploadId,
      workspaceId: req.user.workspaceId,
      bucket,
      key,
      userId: req.user.sub,
      totalBytes: fileSize || 0,
    });
    res.json({ ok: true, uploadId, key, bucket });
  })
);

const uploadPartSchema = z.object({
  bucket: z.string().min(1).max(255),
  key: z.string().min(1).max(2048),
  uploadId: z.string().min(1).max(2048),
  partNumber: z.number().int().min(1).max(10_000),
  data: z.string().min(1), // base64
});

app.post(
  '/api/upload/part',
  authMiddleware,
  validate(uploadPartSchema),
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    const { bucket, key, uploadId, partNumber, data } = req.body as z.infer<
      typeof uploadPartSchema
    >;
    await ensureBucketAllowed(req, bucket);

    const creds = await getWorkspaceCreds(req.user.workspaceId);
    if (!creds) throw new AppError('workspace_not_configured', 400, 'Workspace AWS credentials not configured');
    const region = await getBucketLocation(req.user.workspaceId, bucket, creds);
    const s3Client = getClientForWorkspace(req.user.workspaceId, creds, region);
    const { UploadPartCommand } = await import('@aws-sdk/client-s3');
    const partBuffer = Buffer.from(data, 'base64');
    const response = await s3Client.send(
      new UploadPartCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
        Body: partBuffer,
      })
    );
    await recordPart(uploadId, partNumber, response.ETag!);
    res.json({ ok: true, partNumber, etag: response.ETag });
  })
);

const completeSchema = z.object({
  bucket: z.string().min(1).max(255),
  key: z.string().min(1).max(2048),
  uploadId: z.string().min(1).max(2048),
  parts: z
    .array(z.object({ PartNumber: z.number().int().min(1), ETag: z.string().min(1) }))
    .min(1),
});

app.post(
  '/api/upload/complete',
  authMiddleware,
  validate(completeSchema),
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    const { bucket, key, uploadId, parts } = req.body as z.infer<typeof completeSchema>;
    await ensureBucketAllowed(req, bucket);

    const creds = await getWorkspaceCreds(req.user.workspaceId);
    if (!creds) throw new AppError('workspace_not_configured', 400, 'Workspace AWS credentials not configured');
    const region = await getBucketLocation(req.user.workspaceId, bucket, creds);
    const s3Client = getClientForWorkspace(req.user.workspaceId, creds, region);
    const { CompleteMultipartUploadCommand } = await import('@aws-sdk/client-s3');
    await s3Client.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts.sort((a, b) => a.PartNumber - b.PartNumber) },
      })
    );
    await markCompleted(uploadId);
    await insertAudit(req.user.workspaceId, req.user.sub, 'upload_file', `bucket:${bucket}`, { key });
    res.json({ ok: true, key });
  })
);

const abortSchema = z.object({
  bucket: z.string().min(1).max(255),
  key: z.string().min(1).max(2048),
  uploadId: z.string().min(1).max(2048),
});

app.post(
  '/api/upload/abort',
  authMiddleware,
  validate(abortSchema),
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    const { bucket, key, uploadId } = req.body as z.infer<typeof abortSchema>;
    await ensureBucketAllowed(req, bucket);

    const creds = await getWorkspaceCreds(req.user.workspaceId);
    if (!creds) throw new AppError('workspace_not_configured', 400, 'Workspace AWS credentials not configured');
    const region = await getBucketLocation(req.user.workspaceId, bucket, creds);
    const s3Client = getClientForWorkspace(req.user.workspaceId, creds, region);
    const { AbortMultipartUploadCommand } = await import('@aws-sdk/client-s3');
    await s3Client.send(
      new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId })
    );
    await markAborted(uploadId);
    res.json({ ok: true });
  })
);

const progressParamSchema = z.object({ uploadId: z.string().min(1).max(2048) });

app.get(
  '/api/upload/progress/:uploadId',
  authMiddleware,
  validate(progressParamSchema, 'params'),
  asyncHandler(async (req: AuthRequest, res) => {
    const { uploadId } = req.params as unknown as z.infer<typeof progressParamSchema>;
    const session = await getSession(uploadId);
    if (!session) throw new AppError('upload_not_found', 404);
    res.json(session);
  })
);

// --- final handlers ---------------------------------------------------------

app.use(notFoundHandler);
app.use(errorHandler);

// --- listen + graceful shutdown ---------------------------------------------

const server = app.listen(config.port, () => {
  logger.info({ port: config.port, env: config.nodeEnv }, 'backend_listening');
});

function shutdown(signal: string) {
  logger.info({ signal }, 'shutdown_initiated');
  server.close((err?: Error) => {
    if (err) logger.error({ err }, 'server_close_error');
    try {
      pool.end();
    } catch (e) {
      logger.warn({ err: e }, 'db_close_error');
    }
    process.exit(err ? 1 : 0);
  });
  // Force-exit if shutdown stalls.
  const forceExit = setTimeout(() => {
    logger.warn('shutdown_forced');
    process.exit(1);
  }, 10_000);
  if (typeof forceExit.unref === 'function') forceExit.unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandled_rejection');
});
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'uncaught_exception');
});

export default app;
