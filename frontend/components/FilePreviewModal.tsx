import React, { useState, useEffect, useRef } from 'react';
import { axiosWithAuth } from '../lib/auth';

interface FilePreviewModalProps {
  file: { key: string; name?: string } | null;
  bucket: string;
  onClose: () => void;
}

const FilePreviewModal: React.FC<FilePreviewModalProps> = ({ file, bucket, onClose }) => {
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fileType, setFileType] = useState<
    'image' | 'pdf' | 'video' | 'audio' | 'text' | 'unknown'
  >('unknown');

  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!file || !bucket) return;

    setLoading(true);
    setError(null);
    setPreviewUrl('');
    setFileType('unknown');

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }

    const api = axiosWithAuth();

    api
      .get('/api/file', {
        params: { bucket, key: file.key },
        responseType: 'blob',
      })
      .then((res) => {
        const blob = res.data as Blob;

        // 🔥 PRIMARY DETECTION — MIME BASED
        const mime = blob.type;

        if (mime.startsWith('image/')) {
          setFileType('image');
        } else if (mime === 'application/pdf') {
          setFileType('pdf');
        } else if (mime.startsWith('video/')) {
          setFileType('video');
        } else if (mime.startsWith('audio/')) {
          setFileType('audio');
        } else if (
          mime.startsWith('text/') ||
          mime.includes('json') ||
          mime.includes('xml') ||
          mime.includes('yaml')
        ) {
          setFileType('text');
        } else {
          // 🔄 FALLBACK — EXTENSION BASED
          const ext = file.key.split('.').pop()?.toLowerCase() || '';
          if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext))
            setFileType('image');
          else if (ext === 'pdf') setFileType('pdf');
          else if (['mp4', 'webm', 'ogg', 'mov', 'avi'].includes(ext))
            setFileType('video');
          else if (['mp3', 'wav', 'flac', 'aac'].includes(ext))
            setFileType('audio');
          else if (
            ['txt', 'md', 'log', 'csv', 'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'html', 'css', 'json']
              .includes(ext)
          )
            setFileType('text');
          else setFileType('unknown');
        }

        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        setPreviewUrl(url);
      })
      .catch((err) => {
        console.error('Preview load failed', err);
        setError('Failed to load file preview');
      })
      .finally(() => {
        setLoading(false);
      });

    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [file, bucket]);

  if (!file) return null;

  const fileName = file.key.split('/').pop() || file.key;

  return (
    <div
      style={overlayStyle}
      onClick={onClose}
    >
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={headerStyle}>
          <h2 style={{ margin: 0 }}>{fileName}</h2>
          <button onClick={onClose} style={closeButtonStyle}>×</button>
        </div>

        {/* Content */}
        <div style={contentStyle}>
          {loading && <p style={{ color: 'white' }}>Loading preview...</p>}

          {error && (
            <div style={{ color: 'white' }}>
              <p>{error}</p>
              <a href={previewUrl} download={fileName} style={downloadBtnStyle}>
                Download Instead
              </a>
            </div>
          )}

          {!loading && !error && previewUrl && (
            <>
              {fileType === 'image' && (
                <img
                  src={previewUrl}
                  alt={fileName}
                  style={{ maxWidth: '100%', maxHeight: '100%' }}
                />
              )}

              {fileType === 'pdf' && (
                <iframe
                  src={`${previewUrl}#toolbar=1&navpanes=1&scrollbar=1`}
                  style={{ width: '100%', height: '100%', border: 'none', background: 'white' }}
                  title={fileName}
                />
              )}

              {fileType === 'video' && (
                <video
                  src={previewUrl}
                  controls
                  style={{ maxWidth: '100%', maxHeight: '100%' }}
                />
              )}

              {fileType === 'audio' && (
                <audio
                  src={previewUrl}
                  controls
                  style={{ width: '100%' }}
                />
              )}

              {fileType === 'text' && (
                <iframe
                  src={previewUrl}
                  style={{ width: '100%', height: '100%', border: 'none', background: 'white' }}
                  title={fileName}
                />
              )}

              {fileType === 'unknown' && (
                <div style={{ color: 'white' }}>
                  <p>Preview not available for this file type.</p>
                  <a href={previewUrl} download={fileName} style={downloadBtnStyle}>
                    Download File
                  </a>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

/* ---------------- STYLES ---------------- */

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.75)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 2000,
};

const modalStyle: React.CSSProperties = {
  background: 'white',
  width: '90%',
  maxWidth: '1100px',
  height: '85vh',
  borderRadius: '16px',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  padding: '12px 16px',
  borderBottom: '1px solid #e5e7eb',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const contentStyle: React.CSSProperties = {
  flex: 1,
  background: '#111827',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '16px',
};

const closeButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  fontSize: '22px',
  cursor: 'pointer',
};

const downloadBtnStyle: React.CSSProperties = {
  display: 'inline-block',
  marginTop: '12px',
  padding: '8px 16px',
  background: '#4f46e5',
  color: 'white',
  borderRadius: '6px',
  textDecoration: 'none',
};

export default FilePreviewModal;