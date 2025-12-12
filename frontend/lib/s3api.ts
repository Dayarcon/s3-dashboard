import { axiosWithAuth } from './auth';

export async function listBuckets() {
  const api = axiosWithAuth();
  const res = await api.get('/api/buckets');
  return res.data;
}

export async function listPrefix(bucket: string, prefix = '') {
  const api = axiosWithAuth();
  const res = await api.get('/api/list', { params: { bucket, prefix } });
  return res.data;
}

export async function getFile(bucket: string, key: string) {
  const api = axiosWithAuth();
  const res = await api.get('/api/file', { params: { bucket, key } });
  return res.data as string;
}

export async function putFile(bucket: string, key: string, content: string) {
  const api = axiosWithAuth();
  return api.put('/api/file', { bucket, key, content });
}
