import React, { useCallback, useState } from 'react';
import {
  MULTIPART_CHUNK_SIZE,
  initiateMultipartUpload,
  uploadPart,
  completeMultipartUpload,
  abortMultipartUpload,
  MultipartUploadStatus,
} from '../lib/s3api';

interface UploadWithProgressProps {
  bucket: string;
  prefix?: string;
  onUploadComplete?: () => void;
}

type UploadStatus = MultipartUploadStatus;

interface UploadItem {
  id: string;
  file: File;
  key: string;
  status: UploadStatus;
  progress: number;
  uploadId?: string;
  uploadedBytes: number;
  parts: { PartNumber: number; ETag: string }[];
  error?: string;
}

const createUploadKey = (prefix: string | undefined, fileName: string) => {
  if (!prefix) return fileName;
  const normalized = prefix.endsWith('/') ? prefix : `${prefix}/`;
  return `${normalized}${fileName}`;
};

const UploadWithProgress: React.FC<UploadWithProgressProps> = ({ bucket, prefix, onUploadComplete }) => {
  const [uploads, setUploads] = useState<UploadItem[]>([]);

  const addFilesToQueue = (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    const nextUploads: UploadItem[] = list.map((file) => {
      const key = createUploadKey(prefix, file.name);
      return {
        id: `${key}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
        file,
        key,
        status: 'idle',
        progress: 0,
        uploadedBytes: 0,
        parts: [],
      };
    });
    setUploads((prev) => [...prev, ...nextUploads]);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      addFilesToQueue(e.target.files);
      e.target.value = '';
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFilesToQueue(e.dataTransfer.files);
      e.dataTransfer.clearData();
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const updateUpload = useCallback((id: string, updater: (item: UploadItem) => UploadItem) => {
    setUploads((prev) => prev.map((u) => (u.id === id ? updater(u) : u)));
  }, []);

  const startUpload = async (id: string) => {
    const item = uploads.find((u) => u.id === id);
    if (!item || (item.status !== 'idle' && item.status !== 'error')) return;

    updateUpload(id, (u) => ({ ...u, status: 'uploading', error: undefined }));

    try {
      const init = await initiateMultipartUpload(
        bucket,
        item.key,
        item.file.type || 'application/octet-stream',
        item.file.size
      );
      const uploadId: string = init.uploadId || init.UploadId || init.uploadID;
      if (!uploadId) {
        throw new Error('Failed to initiate multipart upload');
      }

      updateUpload(id, (u) => ({ ...u, uploadId, status: 'uploading' as UploadStatus }));

      const totalBytes = item.file.size;
      const totalParts = Math.ceil(totalBytes / MULTIPART_CHUNK_SIZE);
      let uploadedBytes = 0;
      const parts: { PartNumber: number; ETag: string }[] = [];

      for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
        // Re-read current status before uploading each part (supports pause)
        let current: UploadItem | undefined;
        setUploads((prev) => {
          current = prev.find((u) => u.id === id);
          return prev;
        });
        if (!current || current.status === 'paused' || current.status === 'aborted' || current.status === 'error') {
          // Preserve current state; exit loop
          return;
        }

        const start = (partNumber - 1) * MULTIPART_CHUNK_SIZE;
        const end = Math.min(start + MULTIPART_CHUNK_SIZE, totalBytes);
        const blob = item.file.slice(start, end);
        const arrayBuffer = await blob.arrayBuffer();
        const partRes = await uploadPart(bucket, item.key, uploadId, partNumber, arrayBuffer);

        if (!partRes?.etag && !partRes?.ETag) {
          throw new Error('Part upload failed');
        }
        const etag = partRes.etag || partRes.ETag;
        parts.push({ PartNumber: partNumber, ETag: etag });
        uploadedBytes += end - start;

        const progress = Math.round((uploadedBytes / totalBytes) * 100);
        updateUpload(id, (u) => ({
          ...u,
          uploadedBytes,
          progress,
          parts: [...u.parts, { PartNumber: partNumber, ETag: etag }],
        }));
      }

      // After loop, check final status before completing
      let finalItem: UploadItem | undefined;
      setUploads((prev) => {
        finalItem = prev.find((u) => u.id === id);
        return prev;
      });
      if (!finalItem || finalItem.status !== 'uploading') {
        return;
      }

      await completeMultipartUpload(bucket, item.key, uploadId, parts);

      updateUpload(id, (u) => ({
        ...u,
        status: 'completed',
        progress: 100,
        uploadedBytes: totalBytes,
      }));

      if (onUploadComplete) {
        onUploadComplete();
      }
    } catch (err: any) {
      console.error(err);
      updateUpload(id, (u) => ({
        ...u,
        status: 'error',
        error: err?.message || 'Upload failed',
      }));
    }
  };

  const pauseUpload = (id: string) => {
    updateUpload(id, (u) => {
      if (u.status !== 'uploading') return u;
      return { ...u, status: 'paused' };
    });
  };

  const resumeUpload = async (id: string) => {
    const item = uploads.find((u) => u.id === id);
    if (!item || item.status !== 'paused' || !item.uploadId) return;

    updateUpload(id, (u) => ({ ...u, status: 'uploading' }));

    try {
      const totalBytes = item.file.size;
      const totalParts = Math.ceil(totalBytes / MULTIPART_CHUNK_SIZE);
      let uploadedBytes = item.uploadedBytes;
      const existingParts = [...item.parts];
      const startPartNumber = existingParts.length + 1;

      for (let partNumber = startPartNumber; partNumber <= totalParts; partNumber++) {
        let current: UploadItem | undefined;
        setUploads((prev) => {
          current = prev.find((u) => u.id === id);
          return prev;
        });
        if (!current || current.status === 'paused' || current.status === 'aborted' || current.status === 'error') {
          return;
        }

        const start = (partNumber - 1) * MULTIPART_CHUNK_SIZE;
        const end = Math.min(start + MULTIPART_CHUNK_SIZE, totalBytes);
        const blob = item.file.slice(start, end);
        const arrayBuffer = await blob.arrayBuffer();
        const partRes = await uploadPart(bucket, item.key, item.uploadId, partNumber, arrayBuffer);

        if (!partRes?.etag && !partRes?.ETag) {
          throw new Error('Part upload failed');
        }
        const etag = partRes.etag || partRes.ETag;
        existingParts.push({ PartNumber: partNumber, ETag: etag });
        uploadedBytes += end - start;

        const progress = Math.round((uploadedBytes / totalBytes) * 100);
        updateUpload(id, (u) => ({
          ...u,
          uploadedBytes,
          progress,
          parts: [...existingParts],
        }));
      }

      let finalItem: UploadItem | undefined;
      setUploads((prev) => {
        finalItem = prev.find((u) => u.id === id);
        return prev;
      });
      if (!finalItem || finalItem.status !== 'uploading') {
        return;
      }

      await completeMultipartUpload(bucket, item.key, item.uploadId, existingParts);

      updateUpload(id, (u) => ({
        ...u,
        status: 'completed',
        progress: 100,
        uploadedBytes: totalBytes,
      }));

      if (onUploadComplete) {
        onUploadComplete();
      }
    } catch (err: any) {
      console.error(err);
      updateUpload(id, (u) => ({
        ...u,
        status: 'error',
        error: err?.message || 'Upload failed',
      }));
    }
  };

  const abortUpload = async (id: string) => {
    const item = uploads.find((u) => u.id === id);
    if (!item || !item.uploadId) {
      // If we never initiated upload, just remove from queue
      setUploads((prev) => prev.filter((u) => u.id !== id));
      return;
    }

    try {
      await abortMultipartUpload(bucket, item.key, item.uploadId);
      updateUpload(id, (u) => ({
        ...u,
        status: 'aborted',
      }));
    } catch (err) {
      console.error(err);
      updateUpload(id, (u) => ({
        ...u,
        status: 'error',
        error: 'Failed to abort upload',
      }));
    }
  };

  const clearCompleted = () => {
    setUploads((prev) => prev.filter((u) => u.status !== 'completed' && u.status !== 'aborted'));
  };

  const startAllPending = () => {
    uploads
      .filter((u) => u.status === 'idle' || u.status === 'error')
      .forEach((u) => {
        void startUpload(u.id);
      });
  };

  const hasUploads = uploads.length > 0;

  return (
    <div style={{ border: '1px solid #e5e7eb', padding: '16px', borderRadius: '8px', marginTop: '16px' }}>
      <h3 style={{ margin: 0, marginBottom: '8px' }}>Upload files</h3>
      <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '12px' }}>
        Drag and drop files here or choose files to upload. Large files are uploaded in chunks with pause/resume
        support.
      </p>
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        style={{
          border: '2px dashed #d1d5db',
          borderRadius: '8px',
          padding: '16px',
          textAlign: 'center',
          backgroundColor: '#f9fafb',
          marginBottom: '12px',
        }}
      >
        <p style={{ fontSize: '13px', color: '#4b5563', marginBottom: '8px' }}>Drag files here</p>
        <p style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '8px' }}>or</p>
        <label
          style={{
            display: 'inline-block',
            padding: '6px 12px',
            borderRadius: '6px',
            backgroundColor: '#4f46e5',
            color: 'white',
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          Choose files
          <input
            type="file"
            multiple
            onChange={handleFileInputChange}
            style={{ display: 'none' }}
          />
        </label>
      </div>

      {hasUploads && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <button
              onClick={startAllPending}
              style={{
                padding: '6px 10px',
                fontSize: '12px',
                borderRadius: '6px',
                border: '1px solid #d1d5db',
                backgroundColor: '#f9fafb',
                cursor: 'pointer',
              }}
            >
              Start all
            </button>
            <button
              onClick={clearCompleted}
              style={{
                padding: '6px 10px',
                fontSize: '12px',
                borderRadius: '6px',
                border: '1px solid #e5e7eb',
                backgroundColor: '#fef2f2',
                color: '#b91c1c',
                cursor: 'pointer',
              }}
            >
              Clear completed
            </button>
          </div>

          <div style={{ maxHeight: '260px', overflowY: 'auto' }}>
            {uploads.map((u) => (
              <div
                key={u.id}
                style={{
                  padding: '8px 10px',
                  borderRadius: '6px',
                  border: '1px solid #e5e7eb',
                  marginBottom: '6px',
                  backgroundColor: '#ffffff',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ flex: 1, marginRight: '8px', minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: '13px',
                        fontWeight: 500,
                        color: '#111827',
                        whiteSpace: 'nowrap',
                        textOverflow: 'ellipsis',
                        overflow: 'hidden',
                      }}
                    >
                      {u.file.name}
                    </div>
                    <div style={{ fontSize: '11px', color: '#6b7280' }}>
                      {(u.file.size / (1024 * 1024)).toFixed(2)} MB
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: '11px',
                      padding: '2px 6px',
                      borderRadius: '999px',
                      border: '1px solid #e5e7eb',
                      backgroundColor:
                        u.status === 'completed'
                          ? '#ecfdf3'
                          : u.status === 'error'
                          ? '#fef2f2'
                          : u.status === 'paused'
                          ? '#eff6ff'
                          : '#f9fafb',
                      color:
                        u.status === 'completed'
                          ? '#166534'
                          : u.status === 'error'
                          ? '#b91c1c'
                          : u.status === 'paused'
                          ? '#1d4ed8'
                          : '#374151',
                    }}
                  >
                    {u.status.charAt(0).toUpperCase() + u.status.slice(1)}
                  </span>
                </div>

                <div style={{ marginTop: '4px' }}>
                  <div
                    style={{
                      width: '100%',
                      background: '#f3f4f6',
                      height: '6px',
                      borderRadius: '999px',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${u.progress}%`,
                        background:
                          u.status === 'completed'
                            ? '#16a34a'
                            : u.status === 'error'
                            ? '#dc2626'
                            : '#4f46e5',
                        height: '100%',
                        transition: 'width 150ms linear',
                      }}
                    />
                  </div>
                  <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>{u.progress}%</div>
                </div>

                <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                  {(u.status === 'idle' || u.status === 'error') && (
                    <button
                      onClick={() => void startUpload(u.id)}
                      style={{
                        padding: '4px 8px',
                        fontSize: '11px',
                        borderRadius: '6px',
                        border: '1px solid #d1d5db',
                        backgroundColor: '#f9fafb',
                        cursor: 'pointer',
                      }}
                    >
                      Start
                    </button>
                  )}
                  {u.status === 'uploading' && (
                    <button
                      onClick={() => pauseUpload(u.id)}
                      style={{
                        padding: '4px 8px',
                        fontSize: '11px',
                        borderRadius: '6px',
                        border: '1px solid #d1d5db',
                        backgroundColor: '#eff6ff',
                        cursor: 'pointer',
                      }}
                    >
                      Pause
                    </button>
                  )}
                  {u.status === 'paused' && (
                    <button
                      onClick={() => void resumeUpload(u.id)}
                      style={{
                        padding: '4px 8px',
                        fontSize: '11px',
                        borderRadius: '6px',
                        border: '1px solid #4f46e5',
                        backgroundColor: '#eef2ff',
                        color: '#312e81',
                        cursor: 'pointer',
                      }}
                    >
                      Resume
                    </button>
                  )}
                  {(u.status === 'uploading' || u.status === 'paused' || u.status === 'idle' || u.status === 'error') && (
                    <button
                      onClick={() => void abortUpload(u.id)}
                      style={{
                        padding: '4px 8px',
                        fontSize: '11px',
                        borderRadius: '6px',
                        border: '1px solid #fecaca',
                        backgroundColor: '#fef2f2',
                        color: '#b91c1c',
                        cursor: 'pointer',
                        marginLeft: 'auto',
                      }}
                    >
                      {u.uploadId ? 'Abort' : 'Remove'}
                    </button>
                  )}
                  {u.error && (
                    <span style={{ fontSize: '11px', color: '#b91c1c' }}>
                      {u.error}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default UploadWithProgress;
