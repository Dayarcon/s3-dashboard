import { useEffect, useState } from 'react';
import { getGroups, assignUserToGroup, createUser, getUserDetails, deleteUser } from '../lib/api';
import { axiosWithAuth, getUser, getToken, logout, checkTokenAndLogout } from '../lib/auth';
import Router from 'next/router';
import Link from 'next/link';

interface User {
  id: number;
  username: string;
  role: string;
}

interface Group {
  id: number;
  name: string;
}

interface UserDetail {
  id: number;
  username: string;
  role: string;
  groups?: Array<{ id: number; name: string }>;
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // User creation form state
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('user');
  const [showCreateForm, setShowCreateForm] = useState(false);

  const [selectedUser, setSelectedUser] = useState<UserDetail | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [showAssignGroupModal, setShowAssignGroupModal] = useState(false);
  const [assignGroupUserId, setAssignGroupUserId] = useState<number | null>(null);
  const [assignGroupUsername, setAssignGroupUsername] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);

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
    fetchUsers();
    fetchGroups();
  }, []);

  async function fetchUsers() {
    setLoading(true);
    setError(null);
    try {
      const api = axiosWithAuth();
      const res = await api.get('/api/users');
      setUsers(res.data);
    } catch (err: any) {
      console.error('Failed to fetch users:', err);
      if (err?.response?.status === 404) {
        setError('Users endpoint not available. Please check backend implementation.');
      } else {
        setError(err?.response?.data?.error || 'Failed to load users');
      }
    } finally {
      setLoading(false);
    }
  }

  async function fetchGroups() {
    try {
      const data = await getGroups();
      setGroups(data);
    } catch (err: any) {
      console.error('Failed to fetch groups:', err);
    }
  }

  async function handleCreateUser() {
    if (!newUsername.trim() || !newPassword.trim()) {
      setError('Username and password are required');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await createUser(newUsername.trim(), newPassword, newRole);
      setNewUsername('');
      setNewPassword('');
      setNewRole('user');
      setShowCreateForm(false);
      setSuccess('User created successfully!');
      setTimeout(() => setSuccess(null), 3000);
      fetchUsers(); // Refresh users list
    } catch (err: any) {
      console.error('Failed to create user:', err);
      setError(err?.response?.data?.error || 'Failed to create user');
    } finally {
      setLoading(false);
    }
  }

  function handleOpenAssignGroupModal(userId: number, username: string) {
    setAssignGroupUserId(userId);
    setAssignGroupUsername(username);
    setSelectedGroupId(null);
    setShowAssignGroupModal(true);
  }

  async function handleAssignGroup() {
    if (!assignGroupUserId || !selectedGroupId) return;

    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await assignUserToGroup(assignGroupUserId, selectedGroupId);
      const groupName = groups.find(g => g.id === selectedGroupId)?.name || '';
      setSuccess(`User ${assignGroupUsername} assigned to group ${groupName} successfully!`);
      setTimeout(() => setSuccess(null), 3000);
      setShowAssignGroupModal(false);
      fetchUsers(); // Refresh users list
    } catch (err: any) {
      console.error('Failed to assign group:', err);
      setError(err?.response?.data?.error || 'Failed to assign user to group');
    } finally {
      setLoading(false);
    }
  }

  async function handleViewDetails(userId: number) {
    setLoading(true);
    setError(null);
    setSuccess(null);

    // Find the user from the existing list first
    const user = users.find(u => u.id === userId);

    try {
      const details = await getUserDetails(userId);
      console.log('User details received:', details);

      const userDetail: UserDetail = {
        id: details.id || userId,
        username: details.username || user?.username || '',
        role: details.role || user?.role || 'user',
        groups: details.groups || []
      };

      setSelectedUser(userDetail);
      setShowDetails(true);
    } catch (err: any) {
      console.error('Failed to fetch user details:', err);

      // Fallback: Show basic user info if detailed endpoint fails
      if (user) {
        console.log('Using fallback user info');
        const userDetail: UserDetail = {
          id: user.id,
          username: user.username,
          role: user.role,
          groups: [] // We don't have group info from the basic user list
        };
        setSelectedUser(userDetail);
        setShowDetails(true);

        // Show a warning that group info is not available
        setError('Note: Group information is not available. The user details endpoint may not be fully implemented.');
        setTimeout(() => setError(null), 5000);
      } else {
        let errorMessage = 'Failed to load user details';
        if (err?.response) {
          if (err.response.status === 404) {
            errorMessage = 'User not found or endpoint not available';
          } else if (err.response.status === 403) {
            errorMessage = 'You do not have permission to view user details';
          } else if (err.response.data?.error) {
            errorMessage = err.response.data.error;
          } else if (err.response.data?.message) {
            errorMessage = err.response.data.message;
          }
        } else if (err?.message) {
          errorMessage = err.message;
        }
        setError(errorMessage);
      }
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
                {currentUser?.role === 'admin' && (
                  <>
                    <Link href="/users" style={{ textDecoration: 'none' }}>
                      <button style={{
                        padding: '8px 16px',
                        fontSize: '14px',
                        fontWeight: 500,
                        color: '#4f46e5',
                        backgroundColor: '#eef2ff',
                        border: 'none',
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
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              style={{
                background: 'none',
                border: 'none',
                color: '#991b1b',
                cursor: 'pointer',
                fontSize: '18px',
                padding: '0 8px'
              }}
            >
              ×
            </button>
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
            justifyContent: 'space-between'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {success}
            </div>
            <button
              onClick={() => setSuccess(null)}
              style={{
                background: 'none',
                border: 'none',
                color: '#166534',
                cursor: 'pointer',
                fontSize: '18px',
                padding: '0 8px'
              }}
            >
              ×
            </button>
          </div>
        )}

        {/* Create User Form */}
        <div style={{
          backgroundColor: 'white',
          borderRadius: '8px',
          border: '1px solid #e5e7eb',
          padding: '24px',
          marginBottom: '24px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: showCreateForm ? '16px' : '0' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#111827', margin: 0 }}>
              Create New User
            </h2>
            <button
              onClick={() => {
                setShowCreateForm(!showCreateForm);
                if (showCreateForm) {
                  setNewUsername('');
                  setNewPassword('');
                  setNewRole('user');
                  setError(null);
                }
              }}
              style={{
                padding: '8px 16px',
                fontSize: '14px',
                fontWeight: 500,
                color: '#4f46e5',
                backgroundColor: 'transparent',
                border: '1px solid #4f46e5',
                borderRadius: '6px',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#eef2ff';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              {showCreateForm ? 'Cancel' : '+ New User'}
            </button>
          </div>

          {showCreateForm && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={{
                    display: 'block',
                    fontSize: '14px',
                    fontWeight: 500,
                    color: '#374151',
                    marginBottom: '8px'
                  }}>
                    Username *
                  </label>
                  <input
                    type="text"
                    placeholder="Enter username"
                    value={newUsername}
                    onChange={e => setNewUsername(e.target.value)}
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
                    Password *
                  </label>
                  <input
                    type="password"
                    placeholder="Enter password"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
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
              </div>

              <div>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: 500,
                  color: '#374151',
                  marginBottom: '8px'
                }}>
                  Role
                </label>
                <select
                  value={newRole}
                  onChange={e => setNewRole(e.target.value)}
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
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => {
                    setShowCreateForm(false);
                    setNewUsername('');
                    setNewPassword('');
                    setNewRole('user');
                    setError(null);
                  }}
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
                  onClick={handleCreateUser}
                  disabled={loading || !newUsername.trim() || !newPassword.trim()}
                  style={{
                    padding: '10px 20px',
                    fontSize: '14px',
                    fontWeight: 500,
                    color: 'white',
                    backgroundColor: loading || !newUsername.trim() || !newPassword.trim() ? '#9ca3af' : '#4f46e5',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: loading || !newUsername.trim() || !newPassword.trim() ? 'not-allowed' : 'pointer',
                    transition: 'background-color 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    if (!loading && newUsername.trim() && newPassword.trim()) {
                      e.currentTarget.style.backgroundColor = '#4338ca';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!loading && newUsername.trim() && newPassword.trim()) {
                      e.currentTarget.style.backgroundColor = '#4f46e5';
                    }
                  }}
                >
                  {loading ? 'Creating...' : 'Create User'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* User Details Modal */}
        {showDetails && selectedUser && (
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
              maxWidth: '600px',
              width: '100%',
              maxHeight: '90vh',
              overflow: 'auto',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
            }} onClick={(e) => e.stopPropagation()}>
              <div style={{
                padding: '20px 24px',
                borderBottom: '1px solid #e5e7eb',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <h2 style={{ fontSize: '20px', fontWeight: 600, color: '#111827', margin: 0 }}>
                  User: {selectedUser.username}
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

              <div style={{ padding: '24px' }}>
                <div style={{ marginBottom: '24px' }}>
                  <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '8px' }}>Role</div>
                  <span style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    fontSize: '14px',
                    fontWeight: 500,
                    backgroundColor: selectedUser.role === 'admin' ? '#dbeafe' : '#f3f4f6',
                    color: selectedUser.role === 'admin' ? '#1e40af' : '#374151'
                  }}>
                    {selectedUser.role}
                  </span>
                </div>

                <div>
                  <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#111827', marginBottom: '16px' }}>
                    Groups ({selectedUser.groups?.length || 0})
                  </h3>
                  {selectedUser.groups && selectedUser.groups.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {selectedUser.groups.map((group) => (
                        <div key={group.id} style={{
                          padding: '12px 16px',
                          backgroundColor: '#f9fafb',
                          borderRadius: '8px',
                          border: '1px solid #e5e7eb',
                          fontSize: '14px',
                          fontWeight: 500,
                          color: '#111827'
                        }}>
                          {group.name}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p style={{ color: '#6b7280', fontSize: '14px' }}>User is not assigned to any groups</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Assign Group Modal */}
        {showAssignGroupModal && (
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
          }} onClick={() => setShowAssignGroupModal(false)}>
            <div style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              maxWidth: '500px',
              width: '100%',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
            }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
                <h2 style={{ fontSize: '20px', fontWeight: 600, color: '#111827', margin: 0 }}>
                  Assign Group to {assignGroupUsername}
                </h2>
                <button
                  onClick={() => setShowAssignGroupModal(false)}
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
                    Select Group *
                  </label>
                  <select
                    value={selectedGroupId || ''}
                    onChange={e => setSelectedGroupId(Number(e.target.value))}
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
                    <option value="">-- Select a group --</option>
                    {groups.map(group => (
                      <option key={group.id} value={group.id}>{group.name}</option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '8px' }}>
                  <button
                    onClick={() => setShowAssignGroupModal(false)}
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
                    onClick={handleAssignGroup}
                    disabled={loading || !selectedGroupId}
                    style={{
                      padding: '10px 20px',
                      fontSize: '14px',
                      fontWeight: 500,
                      color: 'white',
                      backgroundColor: loading || !selectedGroupId ? '#9ca3af' : '#4f46e5',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: loading || !selectedGroupId ? 'not-allowed' : 'pointer',
                      transition: 'background-color 0.2s'
                    }}
                    onMouseEnter={(e) => {
                      if (!loading && selectedGroupId) {
                        e.currentTarget.style.backgroundColor = '#4338ca';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!loading && selectedGroupId) {
                        e.currentTarget.style.backgroundColor = '#4f46e5';
                      }
                    }}
                  >
                    {loading ? 'Assigning...' : 'Assign Group'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Users Table */}
        <div style={{
          backgroundColor: 'white',
          borderRadius: '8px',
          border: '1px solid #e5e7eb',
          overflow: 'hidden'
        }}>
          <div style={{ padding: '16px', borderBottom: '1px solid #e5e7eb' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#111827', margin: 0 }}>
              Users ({users.length})
            </h2>
          </div>

          {loading && users.length === 0 ? (
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
          ) : users.length === 0 ? (
            <div style={{ padding: '48px', textAlign: 'center', color: '#6b7280' }}>
              No users found. Create your first user above.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>ID</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>Username</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>Role</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>Actions</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>Remove</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u, index) => (
                  <tr key={u.id} style={{ borderBottom: index < users.length - 1 ? '1px solid #e5e7eb' : 'none' }}>
                    <td style={{ padding: '12px 16px', fontSize: '14px', color: '#6b7280' }}>{u.id}</td>
                    <td style={{ padding: '12px 16px', fontSize: '14px', color: '#111827', fontWeight: 500 }}>{u.username}</td>
                    <td style={{ padding: '12px 16px', fontSize: '14px' }}>
                      <span style={{
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontWeight: 500,
                        backgroundColor: u.role === 'admin' ? '#dbeafe' : '#f3f4f6',
                        color: u.role === 'admin' ? '#1e40af' : '#374151'
                      }}>
                        {u.role}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <button
                          onClick={() => handleViewDetails(u.id)}
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
                          View Details
                        </button>
                        <button
                          onClick={() => handleOpenAssignGroupModal(u.id, u.username)}
                          disabled={loading || groups.length === 0}
                          style={{
                            padding: '6px 12px',
                            fontSize: '13px',
                            fontWeight: 500,
                            color: loading || groups.length === 0 ? '#9ca3af' : '#10b981',
                            backgroundColor: 'transparent',
                            border: '1px solid',
                            borderColor: loading || groups.length === 0 ? '#d1d5db' : '#10b981',
                            borderRadius: '6px',
                            cursor: loading || groups.length === 0 ? 'not-allowed' : 'pointer',
                            transition: 'all 0.2s'
                          }}
                          onMouseEnter={(e) => {
                            if (!loading && groups.length > 0) {
                              e.currentTarget.style.backgroundColor = '#d1fae5';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!loading && groups.length > 0) {
                              e.currentTarget.style.backgroundColor = 'transparent';
                            }
                          }}
                        >
                          Assign Group
                        </button>
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <button
                        onClick={async () => {
                          if (!confirm(`Are you sure you want to delete user "${u.username}"? This action cannot be undone.`)) return;

                          setLoading(true);
                          setError(null);
                          setSuccess(null);

                          try {
                            await deleteUser(u.id);
                            setSuccess(`User "${u.username}" deleted successfully!`);
                            setTimeout(() => setSuccess(null), 3000);
                            fetchUsers(); // Reload list
                          } catch (e: any) {
                            console.error('Failed to delete user:', e);
                            setError(e?.response?.data?.error || e?.message || 'Failed to delete user');
                          } finally {
                            setLoading(false);
                          }
                        }}
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
