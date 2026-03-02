import { axiosWithAuth } from './auth';

export async function listBuckets(regions?: string[]) {
  const api = axiosWithAuth();
  const params: any = {};
  if (regions && regions.length > 0) {
    params.regions = regions.join(',');
  }
  const res = await api.get('/api/buckets', { params });
  return res.data;
}

export async function listRegions(): Promise<{ regions: string[]; allAwsRegions: string[] }> {
  const api = axiosWithAuth();
  const res = await api.get('/api/regions');
  return res.data;
}

export async function listPrefix(bucket: string, prefix = '') {
  const api = axiosWithAuth();
  const res = await api.get('/api/list', { params: { bucket, prefix } });
  return res.data;
}

export async function getFile(bucket: string, key: string) {
  const api = axiosWithAuth();
  const res = await api.get('/api/file', {
    params: { bucket, key },
    responseType: 'text',
    // Ensure axios does not try to JSON-parse the body; we want raw text
    transformResponse: [(data) => data],
  });
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

// Upload file with progress tracking
export async function uploadFile(bucket: string, key: string, file: File, onProgress?: (progress: number) => void) {
  const api = axiosWithAuth();
  const formData = new FormData();
  formData.append('file', file);
  formData.append('bucket', bucket);
  formData.append('key', key);
  return api.post('/api/file/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (progressEvent) => {
      if (onProgress && progressEvent.total) {
        const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        onProgress(progress);
      }
    }
  });
}

// Initiate multipart upload for large files
export async function initiateMultipartUpload(bucket: string, key: string, contentType: string, fileSize: number) {
  const api = axiosWithAuth();
  const res = await api.post('/api/upload/initiate', { bucket, key, contentType, fileSize });
  return res.data;
}

// Upload a single part
export async function uploadPart(bucket: string, key: string, uploadId: string, partNumber: number, data: ArrayBuffer) {
  const api = axiosWithAuth();
  const base64Data = Buffer.from(data).toString('base64');
  const res = await api.post('/api/upload/part', { bucket, key, uploadId, partNumber, data: base64Data });
  return res.data;
}

// Complete multipart upload
export async function completeMultipartUpload(bucket: string, key: string, uploadId: string, parts: Array<{ PartNumber: number; ETag: string }>) {
  const api = axiosWithAuth();
  const res = await api.post('/api/upload/complete', { bucket, key, uploadId, parts });
  return res.data;
}

// Abort multipart upload
export async function abortMultipartUpload(bucket: string, key: string, uploadId: string) {
  const api = axiosWithAuth();
  const res = await api.post('/api/upload/abort', { bucket, key, uploadId });
  return res.data;
}

// Get upload progress
export async function getUploadProgress(uploadId: string, bucket: string, key: string) {
  const api = axiosWithAuth();
  const res = await api.get(`/api/upload/progress/${uploadId}`, { params: { bucket, key } });
  return res.data;
}

// Shared chunk size for multipart uploads (5 MB, AWS minimum for non-final parts)
export const MULTIPART_CHUNK_SIZE = 5 * 1024 * 1024;

export type MultipartUploadStatus = 'idle' | 'uploading' | 'paused' | 'completed' | 'error' | 'aborted';

export interface MultipartUploadCallbacks {
  onProgress?: (uploadedBytes: number, totalBytes: number) => void;
  onStatusChange?: (status: MultipartUploadStatus) => void;
  // Called after initiate; gives uploadId back to caller
  onUploadId?: (uploadId: string) => void;
}

// High-level helper to perform a multipart upload for a single file.
// Pause/resume control is expected to be handled by the caller by stopping/starting calls to this function.
export async function multipartUploadFile(
  bucket: string,
  key: string,
  file: File,
  callbacks: MultipartUploadCallbacks = {}
) {
  const { onProgress, onStatusChange, onUploadId } = callbacks;
  const totalBytes = file.size;

  onStatusChange?.('uploading');

  // 1. Initiate multipart upload
  const init = await initiateMultipartUpload(bucket, key, file.type || 'application/octet-stream', totalBytes);
  const uploadId: string = init.uploadId || init.uploadId || init.UploadId || init.uploadID;
  if (!uploadId) {
    onStatusChange?.('error');
    throw new Error('Failed to initiate multipart upload: missing uploadId');
  }
  onUploadId?.(uploadId);

  let uploadedBytes = 0;
  const parts: Array<{ PartNumber: number; ETag: string }> = [];
  const totalParts = Math.ceil(totalBytes / MULTIPART_CHUNK_SIZE);

  // 2. Upload parts sequentially
  for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
    const start = (partNumber - 1) * MULTIPART_CHUNK_SIZE;
    const end = Math.min(start + MULTIPART_CHUNK_SIZE, totalBytes);
    const blob = file.slice(start, end);
    const arrayBuffer = await blob.arrayBuffer();
    const partRes = await uploadPart(bucket, key, uploadId, partNumber, arrayBuffer);
    if (!partRes?.etag && !partRes?.ETag) {
      onStatusChange?.('error');
      throw new Error('Multipart part upload failed');
    }
    const etag = partRes.etag || partRes.ETag;
    parts.push({ PartNumber: partNumber, ETag: etag });
    uploadedBytes += end - start;
    onProgress?.(uploadedBytes, totalBytes);
  }

  // 3. Complete upload
  await completeMultipartUpload(bucket, key, uploadId, parts);
  onProgress?.(totalBytes, totalBytes);
  onStatusChange?.('completed');
  return { uploadId, key, bucket };
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