import { useEffect, useState } from 'react';
import { getGroups, createGroup, assignPermission } from '../lib/api';
import Router from 'next/router';
import { getToken } from '../lib/auth';

interface Group {
  id: number;
  name: string;
}

export default function GroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const t = getToken();
    if (!t) {
      Router.push('/login');
      return;
    }
    fetchGroups();
  }, []);

  async function fetchGroups() {
    setLoading(true);
    setError(null);
    try {
      const data = await getGroups();
      setGroups(data);
    } catch (err: any) {
      console.error('Failed to fetch groups:', err);
      setError(err?.response?.data?.error || 'Failed to load groups');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateGroup() {
    if (!newGroupName.trim()) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await createGroup(newGroupName.trim());
      setNewGroupName('');
      setSuccess('Group created successfully!');
      setTimeout(() => setSuccess(null), 3000);
      fetchGroups();
    } catch (err: any) {
      console.error('Failed to create group:', err);
      setError(err?.response?.data?.error || 'Failed to create group');
    } finally {
      setLoading(false);
    }
  }

  async function handleAssignPermission(groupId: number) {
    const resource = prompt('Resource (e.g., env/bucket or bucket name):');
    if (!resource) return;
    
    const access = prompt('Access type (read/write/read-write):') as 'read' | 'write' | 'read-write';
    if (!access || !['read', 'write', 'read-write'].includes(access)) {
      alert('Invalid access type. Please use: read, write, or read-write');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await assignPermission(groupId, resource, access);
      setSuccess('Permission assigned successfully!');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      console.error('Failed to assign permission:', err);
      setError(err?.response?.data?.error || 'Failed to assign permission');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb' }}>
      {/* Header */}
      <header style={{ backgroundColor: 'white', borderBottom: '1px solid #e5e7eb', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ padding: '16px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '36px', height: '36px', backgroundColor: '#4f46e5', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'white' }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <div>
              <h1 style={{ fontSize: '18px', fontWeight: 600, color: '#111827', margin: 0 }}>Groups Management</h1>
              <p style={{ fontSize: '12px', color: '#6b7280', margin: 0 }}>Manage groups and permissions</p>
            </div>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px' }}>
        {/* Error/Success Messages */}
        {error && (
          <div style={{
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            padding: '12px 16px',
            borderRadius: '8px',
            marginBottom: '24px',
            fontSize: '14px'
          }}>
            {error}
          </div>
        )}

        {success && (
          <div style={{
            backgroundColor: '#f0fdf4',
            border: '1px solid #bbf7d0',
            color: '#166534',
            padding: '12px 16px',
            borderRadius: '8px',
            marginBottom: '24px',
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            {success}
          </div>
        )}

        {/* Create Group Form */}
        <div style={{
          backgroundColor: 'white',
          borderRadius: '8px',
          border: '1px solid #e5e7eb',
          padding: '24px',
          marginBottom: '24px'
        }}>
          <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#111827', marginBottom: '16px' }}>
            Create New Group
          </h2>
          <div style={{ display: 'flex', gap: '12px' }}>
            <input
              type="text"
              placeholder="Enter group name"
              value={newGroupName}
              onChange={e => setNewGroupName(e.target.value)}
              onKeyPress={e => e.key === 'Enter' && handleCreateGroup()}
              style={{
                flex: 1,
                padding: '10px 12px',
                fontSize: '14px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                outline: 'none',
                boxSizing: 'border-box'
              }}
              onFocus={(e) => e.currentTarget.style.borderColor = '#4f46e5'}
              onBlur={(e) => e.currentTarget.style.borderColor = '#d1d5db'}
            />
            <button
              onClick={handleCreateGroup}
              disabled={loading || !newGroupName.trim()}
              style={{
                padding: '10px 20px',
                fontSize: '14px',
                fontWeight: 500,
                color: 'white',
                backgroundColor: loading || !newGroupName.trim() ? '#9ca3af' : '#4f46e5',
                border: 'none',
                borderRadius: '6px',
                cursor: loading || !newGroupName.trim() ? 'not-allowed' : 'pointer',
                transition: 'background-color 0.2s'
              }}
              onMouseEnter={(e) => {
                if (!loading && newGroupName.trim()) e.currentTarget.style.backgroundColor = '#4338ca';
              }}
              onMouseLeave={(e) => {
                if (!loading && newGroupName.trim()) e.currentTarget.style.backgroundColor = '#4f46e5';
              }}
            >
              {loading ? 'Creating...' : 'Create Group'}
            </button>
          </div>
        </div>

        {/* Groups Table */}
        <div style={{
          backgroundColor: 'white',
          borderRadius: '8px',
          border: '1px solid #e5e7eb',
          overflow: 'hidden'
        }}>
          <div style={{ padding: '16px', borderBottom: '1px solid #e5e7eb' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#111827', margin: 0 }}>
              Groups ({groups.length})
            </h2>
          </div>

          {loading && groups.length === 0 ? (
            <div style={{ padding: '48px', textAlign: 'center' }}>
              <div style={{
                width: '32px',
                height: '32px',
                border: '2px solid #4f46e5',
                borderTopColor: 'transparent',
                borderRadius: '50%',
                margin: '0 auto',
                animation: 'spin 1s linear infinite'
              }}></div>
            </div>
          ) : groups.length === 0 ? (
            <div style={{ padding: '48px', textAlign: 'center', color: '#6b7280' }}>
              No groups found. Create your first group above.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>ID</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>Name</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g, index) => (
                  <tr key={g.id} style={{ borderBottom: index < groups.length - 1 ? '1px solid #e5e7eb' : 'none' }}>
                    <td style={{ padding: '12px 16px', fontSize: '14px', color: '#6b7280' }}>{g.id}</td>
                    <td style={{ padding: '12px 16px', fontSize: '14px', color: '#111827', fontWeight: 500 }}>{g.name}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <button
                        onClick={() => handleAssignPermission(g.id)}
                        disabled={loading}
                        style={{
                          padding: '6px 12px',
                          fontSize: '13px',
                          fontWeight: 500,
                          color: loading ? '#9ca3af' : '#4f46e5',
                          backgroundColor: 'transparent',
                          border: '1px solid',
                          borderColor: loading ? '#d1d5db' : '#4f46e5',
                          borderRadius: '6px',
                          cursor: loading ? 'not-allowed' : 'pointer',
                          transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => {
                          if (!loading) {
                            e.currentTarget.style.backgroundColor = '#eef2ff';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!loading) {
                            e.currentTarget.style.backgroundColor = 'transparent';
                          }
                        }}
                      >
                        Assign Permission
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
