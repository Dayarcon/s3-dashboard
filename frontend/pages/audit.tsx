import { useEffect, useState } from 'react';
import { getAuditLogs, AuditLog } from '../lib/audit';
import { axiosWithAuth, logout } from '../lib/auth';
import Router from 'next/router';
import { getToken, checkTokenAndLogout } from '../lib/auth';
import Link from 'next/link';

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState({ userId: '', action: '', resource: '' });
  const limit = 50;

  useEffect(() => {
    // Check token expiration on component mount
    if (checkTokenAndLogout()) {
      return; // User was logged out, don't proceed
    }
    
    if (!getToken()) Router.push('/login');
  }, []);

  useEffect(() => {
    loadLogs();
  }, [page, filters]);

  async function loadLogs() {
    setLoading(true);
    try {
      const params: any = { limit, offset: page * limit };
      if (filters.userId) params.userId = Number(filters.userId);
      if (filters.action) params.action = filters.action;
      if (filters.resource) params.resource = filters.resource;
      
      const data = await getAuditLogs(params);
      setLogs(data.logs);
      setTotal(data.total);
    } catch (err: any) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setLoading(false);
    }
  }
  const handleLogout = () => {
    logout();
    Router.push('/login');
  };
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
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                </div>
                <div>
                  <h1 style={{ fontSize: '18px', fontWeight: 600, color: '#111827', margin: 0 }}>Users Management</h1>
                  <p style={{ fontSize: '12px', color: '#6b7280', margin: 0 }}>Manage users and group assignments</p>
                </div>
              </div>

              {/* Navigation Menu */}
              <nav style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Link href="/" style={{ textDecoration: 'none' }}>
                  <button style={{
                    padding: '8px 16px',
                    fontSize: '14px',
                    fontWeight: 500,
                    color: '#6b7280',
                    backgroundColor: 'transparent',
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px',
                    cursor: 'pointer'
                  }}>Files</button>
                </Link>
                <Link href="/users" style={{ textDecoration: 'none' }}>
                  <button style={{
                    padding: '8px 16px',
                    fontSize: '14px',
                    fontWeight: 500,
                    color: '#6b7280',
                    backgroundColor: 'transparent',
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px',
                    cursor: 'pointer'
                  }}>Users</button>
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
                    cursor: 'pointer'
                  }}>Groups</button>
                </Link>
                <Link href="/audit" style={{ textDecoration: 'none' }}>
                  <button style={{
                    padding: '8px 16px',
                    fontSize: '14px',
                    fontWeight: 500,
                    color: '#4f46e5',
                    backgroundColor: '#eef2ff',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer'
                  }}>Audit</button>
                </Link>
              </nav>
            </div>
            
            {/* User info and logout */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              {/* user object is not defined in this file, so this block is commented out */}
              {/* {user && (
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
              )} */}
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

      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px' }}>
        {/* Filters */}
        <div style={{ backgroundColor: 'white', padding: '16px', borderRadius: '8px', marginBottom: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
            <input
              type="text"
              placeholder="User ID"
              value={filters.userId}
              onChange={e => setFilters({ ...filters, userId: e.target.value })}
              style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px' }}
            />
            <input
              type="text"
              placeholder="Action"
              value={filters.action}
              onChange={e => setFilters({ ...filters, action: e.target.value })}
              style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px' }}
            />
            <input
              type="text"
              placeholder="Resource"
              value={filters.resource}
              onChange={e => setFilters({ ...filters, resource: e.target.value })}
              style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px' }}
            />
          </div>
        </div>

        {/* Logs Table */}
        <div style={{ backgroundColor: 'white', borderRadius: '8px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: 600 }}>Time</th>
                <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: 600 }}>User</th>
                <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: 600 }}>Action</th>
                <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: 600 }}>Resource</th>
                <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: 600 }}>Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: '12px', fontSize: '14px' }}>
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                  <td style={{ padding: '12px', fontSize: '14px' }}>{log.username || 'N/A'}</td>
                  <td style={{ padding: '12px', fontSize: '14px' }}>{log.action}</td>
                  <td style={{ padding: '12px', fontSize: '14px' }}>{log.resource}</td>
                  <td style={{ padding: '12px', fontSize: '14px' }}>
                    {log.details ? (() => {
                      try {
                        // details may already be an object (backend now parses it) or a JSON string
                        const parsed = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
                        if (parsed && typeof parsed === 'object') {
                          return Object.entries(parsed).map(([key, value]) => (
                            <div key={key}><strong>{key}:</strong> {String(value)}</div>
                          ));
                        }
                        return String(parsed);
                      } catch {
                        return String(log.details);
                      }
                    })() : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '14px', color: '#6b7280' }}>
            Showing {page * limit + 1} to {Math.min((page + 1) * limit, total)} of {total}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              style={{ padding: '8px 16px', border: '1px solid #d1d5db', borderRadius: '6px', cursor: page === 0 ? 'not-allowed' : 'pointer' }}
            >
              Previous
            </button>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={(page + 1) * limit >= total}
              style={{ padding: '8px 16px', border: '1px solid #d1d5db', borderRadius: '6px', cursor: (page + 1) * limit >= total ? 'not-allowed' : 'pointer' }}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}