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

// NEW: Delete single file
export async function deleteFile(bucket: string, key: string) {
  const api = axiosWithAuth();
  return api.delete('/api/file', { data: { bucket, key } });
}

// NEW: Delete multiple files
export async function deleteFiles(bucket: string, keys: string[]) {
  const api = axiosWithAuth();
  return api.post('/api/files/delete', { bucket, keys });
}

// NEW: Copy file
export async function copyFile(bucket: string, sourceKey: string, destKey: string) {
  const api = axiosWithAuth();
  return api.post('/api/file/copy', { bucket, sourceKey, destKey });
}

// NEW: Move/Rename file
export async function moveFile(bucket: string, sourceKey: string, destKey: string) {
  const api = axiosWithAuth();
  return api.post('/api/file/move', { bucket, sourceKey, destKey });
}

// NEW: Get file metadata
export async function getFileMetadata(bucket: string, key: string) {
  const api = axiosWithAuth();
  const res = await api.get('/api/file/info', { params: { bucket, key } });
  return res.data;
}

// NEW: Upload file
export async function uploadFile(bucket: string, key: string, file: File) {
  const api = axiosWithAuth();
  const formData = new FormData();
  formData.append('file', file);
  formData.append('bucket', bucket);
  formData.append('key', key);
  return api.post('/api/file/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
}

// NEW: Create folder
export async function createFolder(bucket: string, folderPath: string) {
  const api = axiosWithAuth();
  return api.post('/api/folder/create', { bucket, folderPath });
}

// NEW: Delete folder
export async function deleteFolder(bucket: string, folderPath: string) {
  const api = axiosWithAuth();
  return api.delete('/api/folder', { data: { bucket, folderPath } });
}