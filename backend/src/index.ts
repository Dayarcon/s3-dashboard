import 'dotenv/config'
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { listBuckets, listAtPrefix, getObjectContent, putObjectContent } from './s3';
import authRoutes from './auth';
import { ensureSuperAdminFromEnv } from './db';
import { authMiddleware } from './middleware/authMiddleware';
import groupRoutes from './groups';
import { permissionMiddleware } from './middleware/permissionMiddleware';
import userRoutes from './users';

dotenv.config();
const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '5mb' }));

// ensure super admin
ensureSuperAdminFromEnv().catch(err => console.error('failed create admin', err));

// auth
app.use('/auth', authRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/users', userRoutes);

app.get('/api/buckets', authMiddleware, permissionMiddleware('bucket', 'read'), async (req, res) => {
  try { const buckets = await listBuckets(); res.json(buckets); }
  catch (err) { console.error(err); res.status(500).json({ error: 'list_buckets_failed' }); }
});

app.get('/api/list', async (req, res) => {
  try {
    const bucket = String(req.query.bucket || '');
    const prefix = String(req.query.prefix || '');
    if (!bucket) return res.status(400).json({ error: 'missing_bucket' });
    const data = await listAtPrefix(bucket, prefix);
    res.json(data);
  } catch (err) { console.error(err); res.status(500).json({ error: 'list_failed' }); }
});

app.get('/api/file', async (req, res) => {
  try {
    const bucket = String(req.query.bucket || '');
    const key = String(req.query.key || '');
    if (!bucket || !key) return res.status(400).json({ error: 'missing_params' });
    const content = await getObjectContent(bucket, key);
    res.send(content);
  } catch (err) { console.error(err); res.status(500).json({ error: 'get_failed' }); }
});

app.put('/api/file', authMiddleware, permissionMiddleware('file', 'write'), async (req, res) => {
  try {
    const { bucket, key, content } = req.body;
    if (!bucket || !key) return res.status(400).json({ error: 'missing_params' });
    await putObjectContent(bucket, key, content);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'put_failed' }); }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Backend listening on ${PORT}`));
