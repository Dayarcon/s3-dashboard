import 'dotenv/config'
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { listBuckets, listAtPrefix, getObjectContent, putObjectContent, deleteObject, 
  deleteObjects, 
  copyObject, 
  moveObject, 
  getObjectMetadata,
  createFolder  } from './s3';
import authRoutes from './auth';
import { ensureSuperAdminFromEnv, getAllowedBucketsForUser } from './db';
import { authMiddleware, AuthRequest } from './middleware/authMiddleware';
import groupRoutes from './groups';
import { permissionMiddleware } from './middleware/permissionMiddleware';
import userRoutes from './users';
import multer from 'multer';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { client } from './s3';
import auditRoutes from './audit';
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

// Listing buckets: require authentication but allow visibility based on explicit bucket assignments.
// We avoid requiring the generic 'bucket' permission here so that assigning a bucket to a group/user
// is enough to make it visible to them.
app.get('/api/buckets', authMiddleware, async (req, res) => {
  try {
    const buckets = await listBuckets();
    // If bucket assignments exist in the system, enforce strict visibility:
    // - if user has allowed buckets -> return only those
    // - if user has no allowed buckets -> return empty list
    // If NO assignments exist at all in the DB, fall back to returning all buckets.
    try {
      const userReq = req as AuthRequest;
      if (userReq.user) {
        // If the user is admin, bypass assignment filtering and return all buckets
        if (userReq.user.role === 'admin') {
          return res.json(buckets);
        }

        const allowed = getAllowedBucketsForUser(userReq.user.sub);

        const counts = db.prepare(`SELECT (SELECT COUNT(*) FROM group_buckets) + (SELECT COUNT(*) FROM user_buckets) as total`).get() as any;
        const totalAssignments = counts ? Number(counts.total || 0) : 0;

        if (Array.isArray(allowed) && allowed.length > 0) {
          const filtered = buckets.filter((b: any) => allowed.includes(b.name));
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

    res.json(buckets);
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
    res.json(data);
  } catch (err) { console.error(err); res.status(500).json({ error: 'list_failed' }); }
});

app.get('/api/file', authMiddleware, async (req, res) => {
  try {
    const bucket = String(req.query.bucket || '');
    const key = String(req.query.key || '');
    if (!bucket || !key) return res.status(400).json({ error: 'missing_params' });
    if (!ensureBucketAllowed(req as AuthRequest, res, bucket)) return;
    const content = await getObjectContent(bucket, key);
    res.send(content);
  } catch (err) { console.error(err); res.status(500).json({ error: 'get_failed' }); }
});

app.put('/api/file', authMiddleware, permissionMiddleware('file', 'write'), async (req, res) => {
  try {
    const { bucket, key, content } = req.body;
    if (!bucket || !key) return res.status(400).json({ error: 'missing_params' });
    if (!ensureBucketAllowed(req as AuthRequest, res, bucket)) return;
    await putObjectContent(bucket, key, content);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'put_failed' }); }
});

app.delete('/api/file', authMiddleware, permissionMiddleware('file', 'write'), async (req, res) => {
  try {
    const { bucket, key } = req.body;
    if (!bucket || !key) return res.status(400).json({ error: 'missing_params' });
    if (!ensureBucketAllowed(req as AuthRequest, res, bucket)) return;
    await deleteObject(bucket, key);
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

      const cmd = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype
      });
      await client.send(cmd);
      
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

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Backend listening on ${PORT}`));
