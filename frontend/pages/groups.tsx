import { useEffect, useState } from 'react';
import { getGroups, createGroup, assignPermission, getGroupDetails, removePermission, removeUserFromGroup, deleteGroup, getGroupBuckets, addGroupBucket, removeGroupBucket } from '../lib/api';
import { axiosWithAuth, getUser, getToken, logout, checkTokenAndLogout } from '../lib/auth';
import Router from 'next/router';
import Link from 'next/link';

interface Group {
  id: number;
  name: string;
}

interface GroupDetail {
  id: number;
  name: string;
  permissions?: Array<{ id: number; resource: string; access: string }>;
  users?: Array<{ id: number; username: string }>;
  buckets?: string[];
}

export default function GroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<GroupDetail | null>(null);
  const [newBucketName, setNewBucketName] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [permissionGroupId, setPermissionGroupId] = useState<number | null>(null);
  const [permissionResource, setPermissionResource] = useState('');
  const [permissionAccess, setPermissionAccess] = useState<'read' | 'write' | 'read-write'>('read');
  const [currentUser, setCurrentUser] = useState<any>(null);

  useEffect(() => {
    // Check token expiration on component mount
    if (checkTokenAndLogout()) {
      return; // User was logged out, don't proceed
    }
    
    const t = getToken();
    if (!t) {
      Router.push('/login');
      return;
    }
    setCurrentUser(getUser());
    fetchGroups();
  }, []);

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

  function handleOpenPermissionModal(groupId: number) {
    setPermissionGroupId(groupId);
    setPermissionResource('');
    setPermissionAccess('read');
    setShowPermissionModal(true);
  }

  async function handleAssignPermission() {
    if (!permissionGroupId || !permissionResource.trim()) return;

    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await assignPermission(permissionGroupId, permissionResource.trim(), permissionAccess);
      setSuccess('Permission assigned successfully!');
      setTimeout(() => setSuccess(null), 3000);
      setShowPermissionModal(false);
      // Refresh group details
      if (selectedGroup && selectedGroup.id === permissionGroupId) {
        handleViewDetails(permissionGroupId);
      } else {
        fetchGroups();
      }
    } catch (err: any) {
      console.error('Failed to assign permission:', err);
      setError(err?.response?.data?.error || 'Failed to assign permission');
    } finally {
      setLoading(false);
    }
  }

  async function handleViewDetails(groupId: number) {
    setLoading(true);
    setError(null);
    try {
      const details = await getGroupDetails(groupId);
      // fetch buckets assigned to group
      try {
        const buckets = await getGroupBuckets(groupId);
        details.buckets = buckets;
      } catch (e) {
        details.buckets = [];
      }
      setSelectedGroup(details);
      setShowDetails(true);
    } catch (err: any) {
      console.error('Failed to fetch group details:', err);
      setError(err?.response?.data?.error || 'Failed to load group details');
    } finally {
      setLoading(false);
    }
  }

  async function handleAddGroupBucket() {
    if (!selectedGroup) return;
    const groupId = selectedGroup.id;
    if (!newBucketName.trim()) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await addGroupBucket(groupId, newBucketName.trim());
      setSuccess('Bucket assigned to group successfully!');
      setNewBucketName('');
      // refresh details
      await handleViewDetails(groupId);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      console.error('Failed to add bucket to group:', err);
      setError(err?.response?.data?.error || 'Failed to add bucket to group');
    } finally {
      setLoading(false);
    }
  }

  async function handleRemoveGroupBucket(bucketName: string) {
    if (!selectedGroup) return;
    if (!confirm(`Remove bucket "${bucketName}" from group ${selectedGroup.name}?`)) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await removeGroupBucket(selectedGroup.id, bucketName);
      setSuccess('Bucket removed from group');
      await handleViewDetails(selectedGroup.id);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      console.error('Failed to remove bucket from group:', err);
      setError(err?.response?.data?.error || 'Failed to remove bucket from group');
    } finally {
      setLoading(false);
    }
  }

  async function handleRemovePermission(groupId: number, permissionId: number) {
    if (!confirm('Are you sure you want to remove this permission?')) return;

    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await removePermission(groupId, permissionId);
      setSuccess('Permission removed successfully!');
      setTimeout(() => setSuccess(null), 3000);
      // Refresh group details
      if (selectedGroup) {
        handleViewDetails(groupId);
      } else {
        fetchGroups();
      }
    } catch (err: any) {
      console.error('Failed to remove permission:', err);
      setError(err?.response?.data?.error || 'Failed to remove permission');
    } finally {
      setLoading(false);
    }
  }

  async function handleRemoveUser(groupId: number, userId: number) {
    if (!confirm('Are you sure you want to remove this user from the group?')) return;

    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await removeUserFromGroup(groupId, userId);
      setSuccess('User removed from group successfully!');
      setTimeout(() => setSuccess(null), 3000);
      // Refresh group details
      if (selectedGroup) {
        handleViewDetails(groupId);
      } else {
        fetchGroups();
      }
    } catch (err: any) {
      console.error('Failed to remove user:', err);
      setError(err?.response?.data?.error || 'Failed to remove user from group');
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteGroup(groupId: number, groupName: string) {
    if (!confirm(`Are you sure you want to delete group "${groupName}"? This will remove all permissions and user assignments. This action cannot be undone.`)) return;

    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await deleteGroup(groupId);
      setSuccess(`Group "${groupName}" deleted successfully!`);
      setTimeout(() => setSuccess(null), 3000);
      if (selectedGroup?.id === groupId) {
        setShowDetails(false);
        setSelectedGroup(null);
      }
      fetchGroups();
    } catch (err: any) {
      console.error('Failed to delete group:', err);
      setError(err?.response?.data?.error || 'Failed to delete group');
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
                  <h1 style={{ fontSize: '18px', fontWeight: 600, color: '#111827', margin: 0 }}>Groups Management</h1>
                  <p style={{ fontSize: '12px', color: '#6b7280', margin: 0 }}>Manage groups and permissions</p>
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
                {currentUser?.role === 'admin' && (
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
                        cursor: 'pointer'
                      }}>Users</button>
                    </Link>
                    <Link href="/groups" style={{ textDecoration: 'none' }}>
                      <button style={{
                        padding: '8px 16px',
                        fontSize: '14px',
                        fontWeight: 500,
                        color: '#4f46e5',
                        backgroundColor: '#eef2ff',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer'
                      }}>Groups</button>
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
                        cursor: 'pointer'
                      }}>Audit</button>
                    </Link>
                  </>
                )}
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

        {/* Group Details Modal */}
        {showDetails && selectedGroup && (
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
          }} onClick={() => setShowDetails(false)}>
            <div style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              maxWidth: '700px',
              width: '100%',
              maxHeight: '90vh',
              overflow: 'auto',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
            }} onClick={(e) => e.stopPropagation()}>
              {/* Modal Header */}
              <div style={{
                padding: '20px 24px',
                borderBottom: '1px solid #e5e7eb',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <h2 style={{ fontSize: '20px', fontWeight: 600, color: '#111827', margin: 0 }}>
                  Group: {selectedGroup.name}
                </h2>
                <button
                  onClick={() => setShowDetails(false)}
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

              {/* Modal Content */}
              <div style={{ padding: '24px' }}>
                {/* Permissions Section */}
                <div style={{ marginBottom: '32px' }}>
                  <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#111827', marginBottom: '16px' }}>
                    Permissions ({selectedGroup.permissions?.length || 0})
                  </h3>
                  {selectedGroup.permissions && selectedGroup.permissions.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {selectedGroup.permissions.map((perm) => (
                        <div key={perm.id} style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '12px 16px',
                          backgroundColor: '#f9fafb',
                          borderRadius: '8px',
                          border: '1px solid #e5e7eb'
                        }}>
                          <div>
                            <div style={{ fontSize: '14px', fontWeight: 500, color: '#111827' }}>
                              {perm.resource}
                            </div>
                            <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
                              Access: <span style={{ fontWeight: 500 }}>{perm.access}</span>
                            </div>
                          </div>
                          <button
                            onClick={() => handleRemovePermission(selectedGroup.id, perm.id)}
                            disabled={loading}
                            style={{
                              padding: '6px 12px',
                              fontSize: '12px',
                              fontWeight: 500,
                              color: '#dc2626',
                              backgroundColor: 'transparent',
                              border: '1px solid #dc2626',
                              borderRadius: '6px',
                              cursor: loading ? 'not-allowed' : 'pointer'
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p style={{ color: '#6b7280', fontSize: '14px' }}>No permissions assigned</p>
                  )}
                </div>

                {/* Users Section */}
                <div>
                  <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#111827', marginBottom: '16px' }}>
                    Users ({selectedGroup.users?.length || 0})
                  </h3>
                  {selectedGroup.users && selectedGroup.users.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {selectedGroup.users.map((user) => (
                        <div key={user.id} style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '12px 16px',
                          backgroundColor: '#f9fafb',
                          borderRadius: '8px',
                          border: '1px solid #e5e7eb'
                        }}>
                          <div style={{ fontSize: '14px', fontWeight: 500, color: '#111827' }}>
                            {user.username}
                          </div>
                          <button
                            onClick={() => handleRemoveUser(selectedGroup.id, user.id)}
                            disabled={loading}
                            style={{
                              padding: '6px 12px',
                              fontSize: '12px',
                              fontWeight: 500,
                              color: '#dc2626',
                              backgroundColor: 'transparent',
                              border: '1px solid #dc2626',
                              borderRadius: '6px',
                              cursor: loading ? 'not-allowed' : 'pointer'
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p style={{ color: '#6b7280', fontSize: '14px' }}>No users in this group</p>
                  )}
                </div>

                {/* Buckets Section */}
                <div style={{ marginTop: '24px' }}>
                  <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#111827', marginBottom: '12px' }}>
                    Buckets ({selectedGroup.buckets?.length || 0})
                  </h3>
                  {selectedGroup.buckets && selectedGroup.buckets.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
                      {selectedGroup.buckets.map((b) => (
                        <div key={b} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', backgroundColor: '#f9fafb', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                          <div style={{ fontSize: '14px', color: '#111827', fontWeight: 500 }}>{b}</div>
                          <button
                            onClick={() => handleRemoveGroupBucket(b)}
                            disabled={loading}
                            style={{
                              padding: '6px 12px',
                              fontSize: '12px',
                              fontWeight: 500,
                              color: '#dc2626',
                              backgroundColor: 'transparent',
                              border: '1px solid #dc2626',
                              borderRadius: '6px',
                              cursor: loading ? 'not-allowed' : 'pointer'
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p style={{ color: '#6b7280', fontSize: '14px', marginBottom: '12px' }}>No buckets assigned to this group</p>
                  )}

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      placeholder="Bucket name to assign"
                      value={newBucketName}
                      onChange={e => setNewBucketName(e.target.value)}
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
                      onClick={handleAddGroupBucket}
                      disabled={loading || !newBucketName.trim()}
                      style={{
                        padding: '10px 16px',
                        fontSize: '14px',
                        fontWeight: 500,
                        color: 'white',
                        backgroundColor: loading || !newBucketName.trim() ? '#9ca3af' : '#4f46e5',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: loading || !newBucketName.trim() ? 'not-allowed' : 'pointer'
                      }}
                    >
                      {loading ? 'Assigning...' : 'Assign Bucket'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Permission Assignment Modal */}
        {showPermissionModal && (
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
            zIndex: 1001,
            padding: '20px'
          }} onClick={() => setShowPermissionModal(false)}>
            <div style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              maxWidth: '500px',
              width: '100%',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
            }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
                <h2 style={{ fontSize: '20px', fontWeight: 600, color: '#111827', margin: 0 }}>Assign Permission</h2>
                <button
                  onClick={() => setShowPermissionModal(false)}
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

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <label style={{
                    display: 'block',
                    fontSize: '14px',
                    fontWeight: 500,
                    color: '#374151',
                    marginBottom: '8px'
                  }}>
                    Resource *
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., bucket, file, or bucket-name"
                    value={permissionResource}
                    onChange={e => setPermissionResource(e.target.value)}
                    style={{
                      width: '100%',
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
                </div>

                <div>
                  <label style={{
                    display: 'block',
                    fontSize: '14px',
                    fontWeight: 500,
                    color: '#374151',
                    marginBottom: '8px'
                  }}>
                    Access Type *
                  </label>
                  <select
                    value={permissionAccess}
                    onChange={e => setPermissionAccess(e.target.value as 'read' | 'write' | 'read-write')}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      fontSize: '14px',
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      outline: 'none',
                      boxSizing: 'border-box',
                      backgroundColor: 'white'
                    }}
                    onFocus={(e) => e.currentTarget.style.borderColor = '#4f46e5'}
                    onBlur={(e) => e.currentTarget.style.borderColor = '#d1d5db'}
                  >
                    <option value="read">Read</option>
                    <option value="write">Write</option>
                    <option value="read-write">Read-Write</option>
                  </select>
                </div>

                <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '8px' }}>
                  <button
                    onClick={() => setShowPermissionModal(false)}
                    style={{
                      padding: '10px 20px',
                      fontSize: '14px',
                      fontWeight: 500,
                      color: '#374151',
                      backgroundColor: 'transparent',
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      transition: 'background-color 0.2s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = '#f3f4f6';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAssignPermission}
                    disabled={loading || !permissionResource.trim()}
                    style={{
                      padding: '10px 20px',
                      fontSize: '14px',
                      fontWeight: 500,
                      color: 'white',
                      backgroundColor: loading || !permissionResource.trim() ? '#9ca3af' : '#4f46e5',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: loading || !permissionResource.trim() ? 'not-allowed' : 'pointer',
                      transition: 'background-color 0.2s'
                    }}
                    onMouseEnter={(e) => {
                      if (!loading && permissionResource.trim()) {
                        e.currentTarget.style.backgroundColor = '#4338ca';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!loading && permissionResource.trim()) {
                        e.currentTarget.style.backgroundColor = '#4f46e5';
                      }
                    }}
                  >
                    {loading ? 'Assigning...' : 'Assign Permission'}
                  </button>
                </div>
              </div>
            </div>
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

        {/* Groups Table - Update the Actions column */}
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
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>Remove</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g, index) => (
                  <tr key={g.id} style={{ borderBottom: index < groups.length - 1 ? '1px solid #e5e7eb' : 'none' }}>
                    <td style={{ padding: '12px 16px', fontSize: '14px', color: '#6b7280' }}>{g.id}</td>
                    <td style={{ padding: '12px 16px', fontSize: '14px', color: '#111827', fontWeight: 500 }}>{g.name}</td>
                    <td style={{ padding: '12px 16px', display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => handleViewDetails(g.id)}
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
                      >
                        View Details
                      </button>
                      <button
                        onClick={() => handleOpenPermissionModal(g.id)}
                        disabled={loading}
                        style={{
                          padding: '6px 12px',
                          fontSize: '13px',
                          fontWeight: 500,
                          color: loading ? '#9ca3af' : '#10b981',
                          backgroundColor: 'transparent',
                          border: '1px solid',
                          borderColor: loading ? '#d1d5db' : '#10b981',
                          borderRadius: '6px',
                          cursor: loading ? 'not-allowed' : 'pointer'
                        }}
                      >
                        Add Permission
                      </button>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                    <button
                        onClick={() => handleDeleteGroup(g.id, g.name)}
                        disabled={loading}
                        style={{
                          padding: '6px 12px',
                          fontSize: '13px',
                          fontWeight: 500,
                          color: loading ? '#9ca3af' : '#dc2626',
                          backgroundColor: 'transparent',
                          border: '1px solid',
                          borderColor: loading ? '#d1d5db' : '#dc2626',
                          borderRadius: '6px',
                          cursor: loading ? 'not-allowed' : 'pointer',
                          transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => {
                          if (!loading) {
                            e.currentTarget.style.backgroundColor = '#fee2e2';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!loading) {
                            e.currentTarget.style.backgroundColor = 'transparent';
                          }
                        }}
                      >
                        Delete
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
