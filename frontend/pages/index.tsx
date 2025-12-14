import { useEffect, useState } from 'react'
import { listBuckets, listPrefix, getFile, putFile } from '../lib/s3api'
import Router from 'next/router';
import { getToken, getUser, logout } from '../lib/auth';
import Link from 'next/link';
import { deleteFile, deleteFiles, copyFile, moveFile, uploadFile, getFileMetadata } from '../lib/s3api';
export default function Explorer(){
  const [buckets, setBuckets] = useState<any[]>([])
  const [selectedBucket, setSelectedBucket] = useState('')
  const [prefix, setPrefix] = useState('')
  const [folders, setFolders] = useState<string[]>([])
  const [files, setFiles] = useState<any[]>([])
  const [history, setHistory] = useState([''])
  const [selectedFile, setSelectedFile] = useState<any>(null)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [user, setUser] = useState<any>(null)
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
const [showUploadModal, setShowUploadModal] = useState(false);
const [showDeleteModal, setShowDeleteModal] = useState(false);
const [showMoveModal, setShowMoveModal] = useState(false);
const [newFileName, setNewFileName] = useState('');


  useEffect(() => {
    const t = getToken();
    if (!t) {
      Router.push('/login');
    } else {
      setUser(getUser());
    }
  }, []);

  const handleLogout = () => {
    logout();
    Router.push('/login');
  };
  
  useEffect(()=>{ 
    setLoading(true)
    listBuckets()
      .then(setBuckets)
      .catch((err) => {
        console.error('Failed to load buckets:', err)
        setError('Failed to load buckets. Please check if the backend is running.')
      })
      .finally(() => setLoading(false))
  },[])

  async function load(pfx=''){
    if(!selectedBucket) return
    setLoading(true)
    setError(null)
    try {
      const d = await listPrefix(selectedBucket, pfx)
      setFolders(d.folders || [])
      setFiles(d.files || [])
    } catch(err: any) {
      setError(err.message || 'Failed to load files')
    } finally {
      setLoading(false)
    }
  }

  useEffect(()=>{ load(prefix) }, [prefix, selectedBucket])

  function enterFolder(folderKey:string){
    setPrefix(folderKey)
    setHistory(h=>[...h, folderKey])
    setSelectedFile(null)
  }

  function clickBreadcrumb(i:number){
    const newHist = history.slice(0,i+1)
    setHistory(newHist)
    setPrefix(newHist[newHist.length-1] || '')
    setSelectedFile(null)
  }

  async function openFile(file:any){
    setLoading(true)
    setSelectedFile(file)
    setError(null)
    try {
      const c = await getFile(selectedBucket, file.key)
      setContent(c)
    } catch(err: any) {
      setError(err.message || 'Failed to load file')
    } finally {
      setLoading(false)
    }
  }

  async function saveFile(){
    if(!selectedFile) return
    setSaving(true)
    setError(null)
    setSaveMessage(null)
    try {
      await putFile(selectedBucket, selectedFile.key, content)
      setSaveMessage('File saved successfully!')
      setTimeout(() => setSaveMessage(null), 3000)
    } catch(err: any) {
      setError(err.message || 'Failed to save file')
    } finally {
      setSaving(false)
    }
  }

  function getFileName(key: string) {
    return key.split('/').pop() || key
  }

  function getFolderName(folderKey: string) {
    const parts = folderKey.replace(prefix, '').split('/').filter(Boolean)
    return parts[parts.length - 1] || folderKey
  }

  // Delete single file
async function handleDeleteFile(key: string) {
  if (!selectedBucket || !confirm(`Delete ${key}?`)) return;
  try {
    await deleteFile(selectedBucket, key);
    setSaveMessage('File deleted successfully!');
    load(prefix); // Reload list
    if (selectedFile?.key === key) setSelectedFile(null);
  } catch (err: any) {
    setError(err.response?.data?.error || 'Failed to delete file');
  }
}

// Bulk delete
async function handleBulkDelete() {
  if (!selectedBucket || selectedFiles.size === 0) return;
  if (!confirm(`Delete ${selectedFiles.size} file(s)?`)) return;
  try {
    await deleteFiles(selectedBucket, Array.from(selectedFiles));
    setSaveMessage(`${selectedFiles.size} file(s) deleted successfully!`);
    setSelectedFiles(new Set());
    load(prefix);
    setSelectedFile(null);
  } catch (err: any) {
    setError(err.response?.data?.error || 'Failed to delete files');
  }
}

// Rename/Move file
async function handleRenameFile(oldKey: string, newKey: string) {
  if (!selectedBucket) return;
  try {
    await moveFile(selectedBucket, oldKey, newKey);
    setSaveMessage('File renamed successfully!');
    load(prefix);
    if (selectedFile?.key === oldKey) {
      setSelectedFile({ ...selectedFile, key: newKey });
    }
  } catch (err: any) {
    setError(err.response?.data?.error || 'Failed to rename file');
  }
}

// Upload file
async function handleUploadFile(file: File) {
  if (!selectedBucket) return;
  const key = prefix ? `${prefix}${file.name}` : file.name;
  try {
    await uploadFile(selectedBucket, key, file);
    setSaveMessage('File uploaded successfully!');
    load(prefix);
  } catch (err: any) {
    setError(err.response?.data?.error || 'Failed to upload file');
  }
}


  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb' }}>
      {/* Header */}
      <header style={{ backgroundColor: 'white', borderBottom: '1px solid #e5e7eb', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ padding: '16px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '36px', height: '36px', backgroundColor: '#4f46e5', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'white' }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                </div>
                <div>
                  <h1 style={{ fontSize: '18px', fontWeight: 600, color: '#111827', margin: 0 }}>S3 Explorer</h1>
                  <p style={{ fontSize: '12px', color: '#6b7280', margin: 0 }}>Manage your S3 files</p>
                </div>
              </div>

              {/* Navigation Menu */}
              <nav style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Link href="/" style={{ textDecoration: 'none' }}>
                  <button style={{
                    padding: '8px 16px',
                    fontSize: '14px',
                    fontWeight: 500,
                    color: '#4f46e5',
                    backgroundColor: '#eef2ff',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#e0e7ff';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = '#eef2ff';
                  }}
                  >
                    Files
                  </button>
                </Link>
                {user?.role === 'admin' && (
                  <>
                <Link href="/users" style={{ textDecoration: 'none' }}>
                  <button style={{
                    padding: '8px 16px',
                    fontSize: '14px',
                    fontWeight: 500,
                    color: '#6b7280',
                    backgroundColor: 'transparent',
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#f3f4f6';
                    e.currentTarget.style.borderColor = '#d1d5db';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.borderColor = '#e5e7eb';
                  }}
                  >
                    Users
                  </button>
                </Link>
                <Link href="/groups" style={{ textDecoration: 'none' }}>
                  <button style={{
                    padding: '8px 16px',
                    fontSize: '14px',
                    fontWeight: 500,
                    color: '#6b7280',
                    backgroundColor: 'transparent',
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#f3f4f6';
                    e.currentTarget.style.borderColor = '#d1d5db';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.borderColor = '#e5e7eb';
                  }}
                  >
                    Groups
                  </button>
                </Link>
                <Link href="/audit" style={{ textDecoration: 'none' }}>
                  <button style={{
                    padding: '8px 16px',
                    fontSize: '14px',
                    fontWeight: 500,
                    color: '#6b7280',
                    backgroundColor: 'transparent',
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#f3f4f6';
                    e.currentTarget.style.borderColor = '#d1d5db';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.borderColor = '#e5e7eb';
                  }}
                  >
                    Audit
                  </button>
                </Link>
                </>
                )}
              </nav>
            </div>
            
            {/* User info and logout */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              {user && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    backgroundColor: '#e5e7eb',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '14px',
                    fontWeight: 500,
                    color: '#4f46e5'
                  }}>
                    {user.username?.charAt(0).toUpperCase() || 'U'}
                  </div>
                  <span style={{ fontSize: '14px', color: '#374151', fontWeight: 500 }}>
                    {user.username || 'User'}
                  </span>
                </div>
              )}
              <button
                onClick={handleLogout}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 16px',
                  fontSize: '14px',
                  fontWeight: 500,
                  color: '#6b7280',
                  backgroundColor: 'transparent',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#f3f4f6';
                  e.currentTarget.style.borderColor = '#9ca3af';
                  e.currentTarget.style.color = '#374151';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.borderColor = '#d1d5db';
                  e.currentTarget.style.color = '#6b7280';
                }}
              >
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      <div style={{ display: 'flex', height: 'calc(100vh - 73px)' }}>
        {/* Sidebar */}
        <div style={{ width: '280px', backgroundColor: 'white', borderRight: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column' }}>
          {/* Bucket Selector */}
          <div style={{ padding: '16px', borderBottom: '1px solid #e5e7eb' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#374151', marginBottom: '8px' }}>
              Bucket
            </label>
            <select 
              value={selectedBucket} 
              onChange={e=>{
                setSelectedBucket(e.target.value)
                setPrefix('')
                setHistory([''])
                setSelectedFile(null)
              }}
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: '14px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                outline: 'none'
              }}
            >
              <option value=''>Select a bucket</option>
              {buckets.map(b=><option key={b.name} value={b.name}>{b.name}</option>)}
            </select>
          </div>

          {/* File Tree */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
            {loading && folders.length === 0 && files.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 0' }}>
                <div style={{ width: '24px', height: '24px', border: '2px solid #4f46e5', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
              </div>
            ) : (
              <>
                {folders.length > 0 && (
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{ padding: '6px 8px', marginBottom: '8px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Folders</span>
                    </div>
                    <div>
                      {folders.map(f=>(
                        <button 
                          key={f} 
                          onClick={()=>enterFolder(f)}
                          style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '6px 8px',
                            textAlign: 'left',
                            fontSize: '14px',
                            color: '#374151',
                            border: 'none',
                            background: 'transparent',
                            cursor: 'pointer',
                            borderRadius: '6px'
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f3f4f6'}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: '#9ca3af', flexShrink: 0 }}>
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                          </svg>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{getFolderName(f)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {files.length > 0 && (
                  <div>
                    <div style={{ padding: '6px 8px', marginBottom: '8px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Files</span>
                    </div>
                    <div>
                      {files.map(file=>(
                        <div
                          key={file.key}
                          style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '2px'
                          }}
                          onMouseEnter={(e) => {
                            const deleteBtn = e.currentTarget.querySelector('.file-delete-btn') as HTMLElement;
                            const renameBtn = e.currentTarget.querySelector('.file-rename-btn') as HTMLElement;
                            if (deleteBtn) deleteBtn.style.display = 'flex';
                            if (renameBtn) renameBtn.style.display = 'flex';
                          }}
                          onMouseLeave={(e) => {
                            const deleteBtn = e.currentTarget.querySelector('.file-delete-btn') as HTMLElement;
                            const renameBtn = e.currentTarget.querySelector('.file-rename-btn') as HTMLElement;
                            if (deleteBtn) deleteBtn.style.display = 'none';
                            if (renameBtn) renameBtn.style.display = 'none';
                          }}
                        >
                          <button 
                            onClick={()=>openFile(file)}
                            style={{
                              flex: 1,
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              padding: '6px 8px',
                              textAlign: 'left',
                              fontSize: '14px',
                              borderRadius: '6px',
                              border: 'none',
                              cursor: 'pointer',
                              backgroundColor: selectedFile?.key === file.key ? '#eef2ff' : 'transparent',
                              color: selectedFile?.key === file.key ? '#4338ca' : '#374151'
                            }}
                            onMouseEnter={(e) => {
                              if (selectedFile?.key !== file.key) {
                                e.currentTarget.style.backgroundColor = '#f3f4f6'
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (selectedFile?.key !== file.key) {
                                e.currentTarget.style.backgroundColor = 'transparent'
                              }
                            }}
                          >
                            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ flexShrink: 0, color: selectedFile?.key === file.key ? '#6366f1' : '#9ca3af' }}>
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{getFileName(file.key)}</span>
                            {file.size && (
                              <span style={{ fontSize: '12px', color: '#9ca3af', marginLeft: 'auto' }}>
                                {Math.round(file.size / 1024)}KB
                              </span>
                            )}
                          </button>
                          <button
                            className="file-rename-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              const newName = prompt('Enter new file name:', getFileName(file.key));
                              if (newName && newName !== getFileName(file.key)) {
                                const newKey = prefix ? `${prefix}${newName}` : newName;
                                handleRenameFile(file.key, newKey);
                              }
                            }}
                            style={{
                              display: 'none',
                              padding: '4px 6px',
                              fontSize: '12px',
                              color: '#4f46e5',
                              backgroundColor: 'transparent',
                              border: '1px solid #4f46e5',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                            title="Rename"
                          >
                            <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            className="file-delete-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteFile(file.key);
                            }}
                            style={{
                              display: 'none',
                              padding: '4px 6px',
                              fontSize: '12px',
                              color: '#dc2626',
                              backgroundColor: 'transparent',
                              border: '1px solid #dc2626',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                            title="Delete"
                          >
                            <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {!loading && folders.length === 0 && files.length === 0 && selectedBucket && (
                  <div style={{ textAlign: 'center', padding: '48px 0' }}>
                    <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: '#d1d5db', margin: '0 auto 12px' }}>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                    </svg>
                    <p style={{ fontSize: '14px', color: '#6b7280', margin: 0 }}>Empty folder</p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Main Content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: 'white' }}>
          {/* Breadcrumb */}
          {selectedBucket && (
            <div style={{ padding: '12px 24px', borderBottom: '1px solid #e5e7eb', backgroundColor: '#f9fafb', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px' }}>
                {history.map((h,i)=>(
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <button 
                      onClick={()=>clickBreadcrumb(i)}
                      style={{
                        padding: '4px 8px',
                        color: '#4b5563',
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        borderRadius: '4px',
                        fontSize: '14px'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = '#4f46e5'
                        e.currentTarget.style.backgroundColor = '#eef2ff'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = '#4b5563'
                        e.currentTarget.style.backgroundColor = 'transparent'
                      }}
                    >
                      {h || 'root'}
                    </button>
                    {i < history.length - 1 && (
                      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: '#9ca3af' }}>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    )}
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => setShowUploadModal(true)}
                  style={{
                    padding: '6px 12px',
                    fontSize: '13px',
                    fontWeight: 500,
                    color: '#4f46e5',
                    backgroundColor: 'transparent',
                    border: '1px solid #4f46e5',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#eef2ff'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent'
                  }}
                >
                  <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Upload
                </button>
                {selectedFiles.size > 0 && (
                  <button
                    onClick={handleBulkDelete}
                    style={{
                      padding: '6px 12px',
                      fontSize: '13px',
                      fontWeight: 500,
                      color: '#dc2626',
                      backgroundColor: 'transparent',
                      border: '1px solid #dc2626',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = '#fee2e2'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent'
                    }}
                  >
                    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Delete ({selectedFiles.size})
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Editor Area */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {error && (
              <div style={{ margin: '16px 24px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: '12px 16px', borderRadius: '8px', fontSize: '14px' }}>
                <div style={{ fontWeight: 500, marginBottom: '4px' }}>Error</div>
                <div>{error}</div>
              </div>
            )}
            
            {saveMessage && (
              <div style={{ margin: '16px 24px', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', padding: '12px 16px', borderRadius: '8px', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {saveMessage}
              </div>
            )}

            {loading && !selectedFile ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ width: '40px', height: '40px', border: '2px solid #4f46e5', borderTopColor: 'transparent', borderRadius: '50%', margin: '0 auto 12px', animation: 'spin 1s linear infinite' }}></div>
                  <p style={{ fontSize: '14px', color: '#6b7280', margin: 0 }}>Loading...</p>
                </div>
              </div>
            ) : selectedFile ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {/* File Header */}
                <div style={{ padding: '16px 24px', borderBottom: '1px solid #e5e7eb', backgroundColor: '#f9fafb', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }}>
                    <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: '#9ca3af', flexShrink: 0 }}>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span style={{ fontSize: '14px', fontWeight: 500, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedFile.key}</span>
                  </div>
                  <button 
                    onClick={saveFile}
                    disabled={saving}
                    style={{
                      padding: '6px 16px',
                      backgroundColor: saving ? '#9ca3af' : '#4f46e5',
                      color: 'white',
                      fontSize: '14px',
                      fontWeight: 500,
                      borderRadius: '6px',
                      border: 'none',
                      cursor: saving ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      flexShrink: 0
                    }}
                  >
                    {saving ? (
                      <>
                        <div style={{ width: '14px', height: '14px', border: '2px solid white', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
                        Saving...
                      </>
                    ) : (
                      <>
                        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Save
                      </>
                    )}
                  </button>
                </div>
                
                {/* Text Editor */}
                <textarea 
                  value={content} 
                  onChange={e=>setContent(e.target.value)} 
                  style={{
                    flex: 1,
                    width: '100%',
                    padding: '16px',
                    border: 'none',
                    outline: 'none',
                    resize: 'none',
                    fontFamily: 'monospace',
                    fontSize: '14px',
                    lineHeight: '1.6',
                    color: '#111827',
                    backgroundColor: 'white'
                  }}
                  placeholder="File content will appear here..."
                  disabled={loading}
                  spellCheck={false}
                />
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <div style={{ textAlign: 'center', maxWidth: '384px' }}>
                  <div style={{ width: '64px', height: '64px', backgroundColor: '#f3f4f6', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                    <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: '#9ca3af' }}>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <h3 style={{ fontSize: '18px', fontWeight: 500, color: '#111827', margin: '0 0 4px 0' }}>No file selected</h3>
                  <p style={{ fontSize: '14px', color: '#6b7280', margin: 0 }}>Select a file from the sidebar to view and edit its contents</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Upload Modal */}
      {showUploadModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '20px'
        }} onClick={() => setShowUploadModal(false)}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            maxWidth: '500px',
            width: '100%',
            padding: '24px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '20px', fontWeight: 600, color: '#111827', margin: 0 }}>Upload File</h2>
              <button
                onClick={() => setShowUploadModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '24px',
                  color: '#6b7280',
                  cursor: 'pointer',
                  padding: '4px 8px'
                }}
              >
                ×
              </button>
            </div>
            <input
              type="file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file && selectedBucket) {
                  handleUploadFile(file);
                  setShowUploadModal(false);
                }
              }}
              style={{
                width: '100%',
                padding: '12px',
                border: '2px dashed #d1d5db',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            />
            <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '12px', margin: 0 }}>
              File will be uploaded to: {prefix || 'root'}
            </p>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
