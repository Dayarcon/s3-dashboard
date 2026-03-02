import { useEffect, useState } from 'react';
import Router from 'next/router';
import Link from 'next/link';
import { getToken, getUser, logout, fetchMe } from '../lib/auth';
import { getBucketMetrics, getDetailedBucketMetrics, getStorageSummary } from '../lib/api';

interface BucketMetric {
  name: string;
  creationDate?: string;
  totalSize: number;
  objectCount: number;
  sizeFormatted: string;
  location?: string;
}

interface DetailedMetric {
  bucketName: string; 
  totalSize: number;
  objectCount: number;
  sizeFormatted: string;
  storageClasses: Array<{ name: string; size: number; count: number; sizeFormatted: string }>;
  topExtensions: Array<{ ext: string; size: number; count: number; sizeFormatted: string }>;
  oldestObject?: string;
  newestObject?: string;
  avgObjectSize: number;
  avgObjectSizeFormatted: string;
}

interface StorageSummary {
  totalStorage: number;
  totalStorageFormatted: string;
  totalObjects: number;
  bucketCount: number;
  buckets: Array<{ name: string; size: number; sizeFormatted: string; objects: number }>;
  storageClassBreakdown: Array<{ name: string; size: number; count: number; sizeFormatted: string }>;
}

export default function MetricsPage() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [buckets, setBuckets] = useState<BucketMetric[]>([]);
  const [summary, setSummary] = useState<StorageSummary | null>(null);
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);
  const [detailedMetrics, setDetailedMetrics] = useState<DetailedMetric | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      Router.push('/login');
      return;
    }
    setUser(getUser());
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [bucketsData, summaryData] = await Promise.all([
        getBucketMetrics(),
        getStorageSummary()
      ]);
      setBuckets(bucketsData || []);
      setSummary(summaryData || null);
    } catch (err: any) {
      console.error('Failed to load metrics:', err);
      setError(err?.response?.data?.error || 'Failed to load storage metrics');
    } finally {
      setLoading(false);
    }
  }

  async function loadDetailedMetrics(bucketName: string) {
    try {
      const metrics = await getDetailedBucketMetrics(bucketName);
      setDetailedMetrics(metrics);
      setShowDetailsModal(true);
    } catch (err: any) {
      console.error('Failed to load detailed metrics:', err);
      setError('Failed to load bucket details');
    }
  }

  function handleLogout() {
    logout();
    Router.push('/login');
  }

  function formatNumber(num: number): string {
    return num.toLocaleString();
  }

  function getStorageClassColor(name: string): string {
    const colors: Record<string, string> = {
      STANDARD: '#4f46e5',
      STANDARD_IA: '#10b981',
      ONEZONE_IA: '#f59e0b',
      GLACIER: '#8b5cf6',
      DEEP_ARCHIVE: '#6b7280',
      REDUCED_REDUNDANCY: '#06b6d4'
    };
    return colors[name] || '#6b7280';
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
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <div>
                  <h1 style={{ fontSize: '18px', fontWeight: 600, color: '#111827', margin: 0 }}>Storage Metrics</h1>
                  <p style={{ fontSize: '12px', color: '#6b7280', margin: 0 }}>Monitor your S3 storage usage</p>
                </div>
              </div>

              {/* Navigation */}
              <nav style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Link href="/" style={{ textDecoration: 'none' }}>
                  <button style={{
                    padding: '8px 16px', fontSize: '14px', fontWeight: 500,
                    color: '#6b7280', backgroundColor: 'transparent',
                    border: '1px solid #e5e7eb', borderRadius: '6px', cursor: 'pointer'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f3f4f6'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    Files
                  </button>
                </Link>
                {user?.role === 'admin' && (
                  <>
                    <Link href="/users" style={{ textDecoration: 'none' }}>
                      <button style={{
                        padding: '8px 16px', fontSize: '14px', fontWeight: 500,
                        color: '#6b7280', backgroundColor: 'transparent',
                        border: '1px solid #e5e7eb', borderRadius: '6px', cursor: 'pointer'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f3f4f6'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                      >
                        Users
                      </button>
                    </Link>
                    <Link href="/groups" style={{ textDecoration: 'none' }}>
                      <button style={{
                        padding: '8px 16px', fontSize: '14px', fontWeight: 500,
                        color: '#6b7280', backgroundColor: 'transparent',
                        border: '1px solid #e5e7eb', borderRadius: '6px', cursor: 'pointer'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f3f4f6'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                      >
                        Groups
                      </button>
                    </Link>
                    <Link href="/audit" style={{ textDecoration: 'none' }}>
                      <button style={{
                        padding: '8px 16px', fontSize: '14px', fontWeight: 500,
                        color: '#6b7280', backgroundColor: 'transparent',
                        border: '1px solid #e5e7eb', borderRadius: '6px', cursor: 'pointer'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f3f4f6'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                      >
                        Audit
                      </button>
                    </Link>
                  </>
                )}
                <Link href="/metrics" style={{ textDecoration: 'none' }}>
                  <button style={{
                    padding: '8px 16px', fontSize: '14px', fontWeight: 500,
                    color: '#4f46e5', backgroundColor: '#eef2ff',
                    border: 'none', borderRadius: '6px', cursor: 'pointer'
                  }}>
                    Metrics
                  </button>
                </Link>
              </nav>
            </div>

            {/* User info and logout */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              {user && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{
                    width: '32px', height: '32px',
                    backgroundColor: '#e5e7eb', borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '14px', fontWeight: 500, color: '#4f46e5'
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
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '8px 16px', fontSize: '14px', fontWeight: 500,
                  color: '#6b7280', backgroundColor: 'transparent',
                  border: '1px solid #d1d5db', borderRadius: '6px',
                  cursor: 'pointer'
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

      {/* Main Content */}
      <main style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
        {error && (
          <div style={{
            marginBottom: '24px', backgroundColor: '#fef2f2',
            border: '1px solid #fecaca', color: '#991b1b',
            padding: '12px 16px', borderRadius: '8px', fontSize: '14px'
          }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '64px 0' }}>
            <div style={{ width: '40px', height: '40px', border: '2px solid #4f46e5', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            {summary && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '24px', marginBottom: '32px' }}>
                {/* Total Storage */}
                <div style={{
                  backgroundColor: 'white', borderRadius: '12px', padding: '24px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                    <div style={{
                      width: '40px', height: '40px', backgroundColor: '#eef2ff',
                      borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                      <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: '#4f46e5' }}>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
                      </svg>
                    </div>
                    <span style={{ fontSize: '14px', color: '#6b7280', fontWeight: 500 }}>Total Storage</span>
                  </div>
                  <div style={{ fontSize: '28px', fontWeight: 700, color: '#111827', marginBottom: '4px' }}>
                    {summary.totalStorageFormatted}
                  </div>
                  <div style={{ fontSize: '13px', color: '#6b7280' }}>
                    Across {summary.bucketCount} bucket{summary.bucketCount !== 1 ? 's' : ''}
                  </div>
                </div>

                {/* Total Objects */}
                <div style={{
                  backgroundColor: 'white', borderRadius: '12px', padding: '24px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                    <div style={{
                      width: '40px', height: '40px', backgroundColor: '#f0fdf4',
                      borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                      <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: '#10b981' }}>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <span style={{ fontSize: '14px', color: '#6b7280', fontWeight: 500 }}>Total Objects</span>
                  </div>
                  <div style={{ fontSize: '28px', fontWeight: 700, color: '#111827', marginBottom: '4px' }}>
                    {formatNumber(summary.totalObjects)}
                  </div>
                  <div style={{ fontSize: '13px', color: '#6b7280' }}>
                    Files and folders
                  </div>
                </div>

                {/* Bucket Count */}
                <div style={{
                  backgroundColor: 'white', borderRadius: '12px', padding: '24px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                    <div style={{
                      width: '40px', height: '40px', backgroundColor: '#fef3c7',
                      borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                      <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: '#f59e0b' }}>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                      </svg>
                    </div>
                    <span style={{ fontSize: '14px', color: '#6b7280', fontWeight: 500 }}>Buckets</span>
                  </div>
                  <div style={{ fontSize: '28px', fontWeight: 700, color: '#111827', marginBottom: '4px' }}>
                    {formatNumber(summary.bucketCount)}
                  </div>
                  <div style={{ fontSize: '13px', color: '#6b7280' }}>
                    S3 buckets accessible
                  </div>
                </div>

                {/* Avg per Bucket */}
                <div style={{
                  backgroundColor: 'white', borderRadius: '12px', padding: '24px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                    <div style={{
                      width: '40px', height: '40px', backgroundColor: '#fae8ff',
                      borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                      <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: '#d946ef' }}>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
                      </svg>
                    </div>
                    <span style={{ fontSize: '14px', color: '#6b7280', fontWeight: 500 }}>Avg Objects/Bucket</span>
                  </div>
                  <div style={{ fontSize: '28px', fontWeight: 700, color: '#111827', marginBottom: '4px' }}>
                    {formatNumber(summary.bucketCount > 0 ? Math.round(summary.totalObjects / summary.bucketCount) : 0)}
                  </div>
                  <div style={{ fontSize: '13px', color: '#6b7280' }}>
                    Objects per bucket
                  </div>
                </div>
              </div>
            )}

            {/* Storage Class Breakdown */}
            {summary && summary.storageClassBreakdown.length > 0 && (
              <div style={{
                backgroundColor: 'white', borderRadius: '12px', padding: '24px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: '32px'
              }}>
                <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#111827', marginBottom: '16px' }}>
                  Storage Class Breakdown
                </h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                  {summary.storageClassBreakdown.map((sc) => (
                    <div key={sc.name} style={{
                      padding: '16px', borderRadius: '8px',
                      backgroundColor: '#f9fafb',
                      borderLeft: `4px solid ${getStorageClassColor(sc.name)}`
                    }}>
                      <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: 500, marginBottom: '4px' }}>
                        {sc.name.replace('_', ' ')}
                      </div>
                      <div style={{ fontSize: '18px', fontWeight: 600, color: '#111827' }}>
                        {sc.sizeFormatted}
                      </div>
                      <div style={{ fontSize: '13px', color: '#6b7280' }}>
                        {formatNumber(sc.count)} objects
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Buckets Table */}
            <div style={{
              backgroundColor: 'white', borderRadius: '12px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)', overflow: 'hidden'
            }}>
              <div style={{ padding: '24px', borderBottom: '1px solid #e5e7eb' }}>
                <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#111827', margin: 0 }}>
                  Bucket Details
                </h2>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f9fafb' }}>
                      <th style={{ padding: '12px 24px', textAlign: 'left', fontSize: '12px', fontWeight: 500, color: '#6b7280', textTransform: 'uppercase' }}>Bucket Name</th>
                      <th style={{ padding: '12px 24px', textAlign: 'left', fontSize: '12px', fontWeight: 500, color: '#6b7280', textTransform: 'uppercase' }}>Size</th>
                      <th style={{ padding: '12px 24px', textAlign: 'left', fontSize: '12px', fontWeight: 500, color: '#6b7280', textTransform: 'uppercase' }}>Objects</th>
                      <th style={{ padding: '12px 24px', textAlign: 'left', fontSize: '12px', fontWeight: 500, color: '#6b7280', textTransform: 'uppercase' }}>Location</th>
                      <th style={{ padding: '12px 24px', textAlign: 'right', fontSize: '12px', fontWeight: 500, color: '#6b7280', textTransform: 'uppercase' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {buckets.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ padding: '48px 24px', textAlign: 'center', color: '#6b7280' }}>
                          <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: '#d1d5db', margin: '0 auto 12px' }}>
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                          </svg>
                          No buckets found
                        </td>
                      </tr>
                    ) : (
                      buckets.map((bucket) => (
                        <tr key={bucket.name} style={{ borderTop: '1px solid #e5e7eb' }}>
                          <td style={{ padding: '16px 24px', fontSize: '14px', fontWeight: 500, color: '#111827' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: '#4f46e5' }}>
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                              </svg>
                              {bucket.name}
                            </div>
                          </td>
                          <td style={{ padding: '16px 24px', fontSize: '14px', color: '#374151' }}>
                            {bucket.sizeFormatted}
                          </td>
                          <td style={{ padding: '16px 24px', fontSize: '14px', color: '#374151' }}>
                            {formatNumber(bucket.objectCount)}
                          </td>
                          <td style={{ padding: '16px 24px', fontSize: '14px', color: '#6b7280' }}>
                            {bucket.location || 'N/A'}
                          </td>
                          <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                            <button
                              onClick={() => loadDetailedMetrics(bucket.name)}
                              style={{
                                padding: '6px 12px', fontSize: '13px', fontWeight: 500,
                                color: '#4f46e5', backgroundColor: '#eef2ff',
                                border: 'none', borderRadius: '6px', cursor: 'pointer'
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#e0e7ff'}
                              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#eef2ff'}
                            >
                              View Details
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>

      {/* Details Modal */}
      {showDetailsModal && detailedMetrics && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, padding: '20px'
        }} onClick={() => setShowDetailsModal(false)}>
          <div style={{
            backgroundColor: 'white', borderRadius: '12px',
            maxWidth: '800px', width: '100%', maxHeight: '80vh', overflow: 'auto',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ padding: '24px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#111827', margin: 0 }}>
                  {detailedMetrics.bucketName}
                </h2>
                <p style={{ fontSize: '13px', color: '#6b7280', margin: '4px 0 0 0' }}>
                  Detailed storage metrics
                </p>
              </div>
              <button
                onClick={() => setShowDetailsModal(false)}
                style={{
                  background: 'none', border: 'none', fontSize: '24px',
                  color: '#6b7280', cursor: 'pointer', padding: '4px 8px'
                }}
              >
                ×
              </button>
            </div>

            <div style={{ padding: '24px' }}>
              {/* Quick Stats */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', marginBottom: '24px' }}>
                <div style={{ padding: '16px', backgroundColor: '#f9fafb', borderRadius: '8px' }}>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Total Size</div>
                  <div style={{ fontSize: '20px', fontWeight: 600, color: '#111827' }}>{detailedMetrics.sizeFormatted}</div>
                </div>
                <div style={{ padding: '16px', backgroundColor: '#f9fafb', borderRadius: '8px' }}>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Object Count</div>
                  <div style={{ fontSize: '20px', fontWeight: 600, color: '#111827' }}>{formatNumber(detailedMetrics.objectCount)}</div>
                </div>
                <div style={{ padding: '16px', backgroundColor: '#f9fafb', borderRadius: '8px' }}>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Avg Object Size</div>
                  <div style={{ fontSize: '20px', fontWeight: 600, color: '#111827' }}>{detailedMetrics.avgObjectSizeFormatted}</div>
                </div>
                <div style={{ padding: '16px', backgroundColor: '#f9fafb', borderRadius: '8px' }}>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Date Range</div>
                  <div style={{ fontSize: '13px', color: '#374151' }}>
                    {detailedMetrics.oldestObject ? new Date(detailedMetrics.oldestObject).toLocaleDateString() : 'N/A'} - {detailedMetrics.newestObject ? new Date(detailedMetrics.newestObject).toLocaleDateString() : 'N/A'}
                  </div>
                </div>
              </div>

              {/* Storage Classes */}
              {detailedMetrics.storageClasses.length > 0 && (
                <div style={{ marginBottom: '24px' }}>
                  <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#111827', marginBottom: '12px' }}>
                    Storage Classes
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
                    {detailedMetrics.storageClasses.map((sc) => (
                      <div key={sc.name} style={{
                        padding: '12px', borderRadius: '8px', backgroundColor: '#f9fafb',
                        borderLeft: `3px solid ${getStorageClassColor(sc.name)}`
                      }}>
                        <div style={{ fontSize: '11px', color: '#6b7280', fontWeight: 500, marginBottom: '4px' }}>
                          {sc.name.replace('_', ' ')}
                        </div>
                        <div style={{ fontSize: '16px', fontWeight: 600, color: '#111827' }}>
                          {sc.sizeFormatted}
                        </div>
                        <div style={{ fontSize: '12px', color: '#6b7280' }}>
                          {formatNumber(sc.count)} objects
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Top Extensions */}
              {detailedMetrics.topExtensions.length > 0 && (
                <div>
                  <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#111827', marginBottom: '12px' }}>
                    Top File Types (by size)
                  </h3>
                  <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#f9fafb' }}>
                          <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: '11px', fontWeight: 500, color: '#6b7280', textTransform: 'uppercase' }}>Extension</th>
                          <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: '11px', fontWeight: 500, color: '#6b7280', textTransform: 'uppercase' }}>Size</th>
                          <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: '11px', fontWeight: 500, color: '#6b7280', textTransform: 'uppercase' }}>Count</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailedMetrics.topExtensions.map((ext, idx) => (
                          <tr key={ext.ext} style={{ borderTop: idx === 0 ? 'none' : '1px solid #e5e7eb' }}>
                            <td style={{ padding: '12px 16px', fontSize: '13px', fontWeight: 500, color: '#111827' }}>
                              {ext.ext === 'no_extension' ? '(no extension)' : `.${ext.ext}`}
                            </td>
                            <td style={{ padding: '12px 16px', fontSize: '13px', color: '#374151' }}>
                              {ext.sizeFormatted}
                            </td>
                            <td style={{ padding: '12px 16px', fontSize: '13px', color: '#374151', textAlign: 'right' }}>
                              {formatNumber(ext.count)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
