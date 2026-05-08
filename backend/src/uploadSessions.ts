// backend/src/uploadSessions.ts
// Wrapper around db functions for upload session management

import {
  createSession as dbCreateSession,
  getSession as dbGetSession,
  recordPart as dbRecordPart,
  markCompleted as dbMarkCompleted,
  markAborted as dbMarkAborted,
  cleanupStale as dbCleanupStale,
} from './db';

export type UploadStatus = 'pending' | 'uploading' | 'completed' | 'aborted' | 'error';
export type Part = { PartNumber: number; ETag: string };

export type UploadSession = {
  uploadId: string;
  bucket: string;
  key: string;
  userId: number | null;
  totalBytes: number;
  uploadedBytes: number;
  status: UploadStatus;
  parts: Part[];
  progress: number; // percent (0..100)
};

function rowToSession(row: any): UploadSession {
  const total = Number(row.total_bytes || 0);
  const uploaded = Number(row.uploaded_bytes || 0);
  const progress = total > 0 ? Math.min(100, Math.max(0, Math.round((uploaded / total) * 100))) : 0;
  return {
    uploadId: row.upload_id,
    bucket: row.bucket,
    key: row.key,
    userId: row.user_id ?? null,
    totalBytes: total,
    uploadedBytes: uploaded,
    status: row.status as UploadStatus,
    parts: typeof row.parts === 'string' ? JSON.parse(row.parts || '[]') : (row.parts || []) as Part[],
    progress,
  };
}

export async function createSession(args: {
  uploadId: string;
  workspaceId: number;
  bucket: string;
  key: string;
  userId: number | null;
  totalBytes: number;
}) {
  await dbCreateSession(
    args.uploadId,
    args.workspaceId,
    args.bucket,
    args.key,
    args.userId,
    args.totalBytes
  );
}

export async function getSession(uploadId: string): Promise<UploadSession | null> {
  const row = await dbGetSession(uploadId);
  return row ? rowToSession(row) : null;
}

export async function recordPart(uploadId: string, partNumber: number, etag: string): Promise<void> {
  await dbRecordPart(uploadId, partNumber, etag);
}

export async function markCompleted(uploadId: string): Promise<void> {
  await dbMarkCompleted(uploadId);
}

export async function markAborted(uploadId: string): Promise<void> {
  await dbMarkAborted(uploadId);
}

export async function cleanupStale(maxAgeMs: number): Promise<void> {
  await dbCleanupStale(maxAgeMs);
}
