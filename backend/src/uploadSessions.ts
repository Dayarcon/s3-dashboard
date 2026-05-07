// backend/src/uploadSessions.ts
import { db } from './db';

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
    parts: JSON.parse(row.parts_json || '[]') as Part[],
    progress,
  };
}

export function createSession(args: {
  uploadId: string;
  bucket: string;
  key: string;
  userId: number | null;
  totalBytes: number;
}) {
  db.prepare(
    `INSERT INTO upload_sessions (upload_id, bucket, key, user_id, total_bytes, uploaded_bytes, status, parts_json)
     VALUES (?, ?, ?, ?, ?, 0, 'pending', '[]')`
  ).run(args.uploadId, args.bucket, args.key, args.userId, args.totalBytes);
}

export function getSession(uploadId: string): UploadSession | null {
  const row = db.prepare('SELECT * FROM upload_sessions WHERE upload_id = ?').get(uploadId);
  return row ? rowToSession(row) : null;
}

export function recordPart(uploadId: string, part: Part, bytes: number) {
  const row = db
    .prepare('SELECT parts_json, uploaded_bytes FROM upload_sessions WHERE upload_id = ?')
    .get(uploadId) as any;
  if (!row) return;
  const parts: Part[] = JSON.parse(row.parts_json || '[]');
  // Replace any existing part with same PartNumber, then append.
  const filtered = parts.filter((p) => p.PartNumber !== part.PartNumber);
  filtered.push(part);
  const uploaded = Number(row.uploaded_bytes || 0) + bytes;
  db.prepare(
    `UPDATE upload_sessions
     SET parts_json = ?, uploaded_bytes = ?, status = 'uploading', updated_at = CURRENT_TIMESTAMP
     WHERE upload_id = ?`
  ).run(JSON.stringify(filtered), uploaded, uploadId);
}

export function markCompleted(uploadId: string) {
  db.prepare(
    `UPDATE upload_sessions
     SET status = 'completed', uploaded_bytes = total_bytes, updated_at = CURRENT_TIMESTAMP
     WHERE upload_id = ?`
  ).run(uploadId);
}

export function markAborted(uploadId: string) {
  db.prepare(
    `UPDATE upload_sessions SET status = 'aborted', updated_at = CURRENT_TIMESTAMP WHERE upload_id = ?`
  ).run(uploadId);
}

/** Drop sessions older than the given age (ms) and not currently uploading. */
export function cleanupStale(maxAgeMs: number) {
  const cutoffIso = new Date(Date.now() - maxAgeMs).toISOString();
  db.prepare(
    `DELETE FROM upload_sessions
     WHERE updated_at < ?
     AND status IN ('completed', 'aborted', 'error')`
  ).run(cutoffIso);
}
