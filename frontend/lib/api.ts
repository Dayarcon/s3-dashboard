import axios from 'axios';
import { axiosWithAuth, logout } from './auth';

export async function getGroups() {
  const api = axiosWithAuth();
  const res = await api.get('/api/groups');
  return res.data;
}

export async function createGroup(name: string) {
  const api = axiosWithAuth();
  const res = await api.post('/api/groups', { name });
  return res.data;
}

export async function assignPermission(groupId: number, resource: string, access: 'read' | 'write' | 'read-write') {
  const api = axiosWithAuth();
  const res = await api.post(`/api/groups/${groupId}/permissions`, { resource, access });
  return res.data;
}

export async function assignUserToGroup(userId: number, groupId: number) {
  const api = axiosWithAuth();
  const res = await api.post(`/api/groups/users/${userId}/groups`, { groupId });
  return res.data;
}

// Add create user function
export async function createUser(username: string, password: string, role: string = 'user') {
  const api = axiosWithAuth();
  const res = await api.post('/api/users', { username, password, role });
  return res.data;
}

export async function getGroupDetails(groupId: number) {
  const api = axiosWithAuth();
  return (await api.get(`/api/groups/${groupId}`)).data;
}

export async function removeUserFromGroup(groupId: number, userId: number) {
  const api = axiosWithAuth();
  await api.delete(`/api/groups/${groupId}/users/${userId}`);
}

export async function removePermission(groupId: number, permissionId: number) {
  const api = axiosWithAuth();
  await api.delete(`/api/groups/${groupId}/permissions/${permissionId}`);
}

export async function getUserDetails(userId: number) {
  const api = axiosWithAuth();
  try {
    const res = await api.get(`/api/users/${userId}`);
    return res.data;
  } catch (error: any) {
    console.error('getUserDetails API error:', error);
    // Re-throw to let the component handle it
    throw error;
  }
}

export async function deleteUser(userId: number) {
  const api = axiosWithAuth();
  await api.delete(`/api/users/${userId}`);
}

// NEW: Update user
export async function updateUser(userId: number, data: { username?: string; role?: string; is_active?: boolean }) {
    const api = axiosWithAuth();
    const res = await api.put(`/api/users/${userId}`, data);
    return res.data;
  }
  
  // NEW: Activate/Deactivate user
  export async function updateUserStatus(userId: number, is_active: boolean) {
    const api = axiosWithAuth();
    const res = await api.patch(`/api/users/${userId}/status`, { is_active });
    return res.data;
  }

  // NEW: Logout (call API)
export async function logoutAPI() {
    const api = axiosWithAuth();
    try {
      await api.post('/auth/logout');
    } catch (err) {
      console.error('Logout API error:', err);
    } finally {
      logout(); // Clear local storage
    }
  }
  
  // NEW: Change password
  export async function changePassword(currentPassword: string, newPassword: string) {
    const api = axiosWithAuth();
    const res = await api.post('/auth/change-password', { currentPassword, newPassword });
    return res.data;
  }
  
  // NEW: Refresh token
  export async function refreshToken() {
    const api = axiosWithAuth();
    const res = await api.post('/auth/refresh');
    if (res.data.token) {
      localStorage.setItem('s3dash_token', res.data.token);
    }
    return res.data;
  }
  
  export async function deleteGroup(groupId: number) {
    const api = axiosWithAuth();
    await api.delete(`/api/groups/${groupId}`);
  }

  export async function getGroupBuckets(groupId: number) {
    const api = axiosWithAuth();
    const res = await api.get(`/api/groups/${groupId}/buckets`);
    // Normalize to array of bucket name strings. Backend may return rows like { id, bucket_name }.
    const data = res.data;
    if (!data) return [];
    if (Array.isArray(data)) {
      return data.map((d: any) => (typeof d === 'string' ? d : (d.bucket_name || d.name || d.bucket || ''))).filter(Boolean);
    }
    return [];
  }

  export async function addGroupBucket(groupId: number, bucketName: string) {
    const api = axiosWithAuth();
    return (await api.post(`/api/groups/${groupId}/buckets`, { bucket_name: bucketName })).data;
  }

  export async function removeGroupBucket(groupId: number, bucketName: string) {
    const api = axiosWithAuth();
    // encode bucketName into URL
    await api.delete(`/api/groups/${groupId}/buckets/${encodeURIComponent(bucketName)}`);
  }

  export async function resetUserPassword(userId: number, newPassword?: string, must_change?: boolean) {
    const api = axiosWithAuth();
    const body: any = {};
    if (newPassword !== undefined) body.newPassword = newPassword;
    if (must_change !== undefined) body.must_change = must_change;
    const res = await api.post(`/api/users/${userId}/reset-password`, body);
    return res.data;
  }

  // Storage Metrics
export async function getBucketMetrics() {
    const api = axiosWithAuth();
    const res = await api.get('/api/metrics/buckets');
    return res.data;
  }

  export async function getDetailedBucketMetrics(bucketName: string) {
    const api = axiosWithAuth();
    const res = await api.get(`/api/metrics/bucket/${encodeURIComponent(bucketName)}`);
    return res.data;
  }

  export async function getStorageSummary() {
    const api = axiosWithAuth();
    const res = await api.get('/api/metrics/summary');
    return res.data;
  }

  // Workspace APIs
  export async function connectAWSCredentials(accessKeyId: string, secretAccessKey: string, region: string = 'us-east-1') {
    const api = axiosWithAuth();
    const res = await api.post('/api/workspace/credentials', {
      accessKeyId,
      secretAccessKey,
      region,
    });
    return res.data;
  }

  export async function inviteUser(role: 'admin' | 'member' = 'member') {
    const api = axiosWithAuth();
    const res = await api.post('/api/workspace/invite', { role });
    return res.data;
  }

  export async function validateInviteCode(code: string) {
    const api = axios.create({ baseURL: process.env.NEXT_PUBLIC_BACKEND_URL });
    const res = await api.get(`/api/workspace/invite/${code}`);
    return res.data;
  }

  export async function joinWorkspace(code: string, username: string, password: string) {
    const api = axios.create({ baseURL: process.env.NEXT_PUBLIC_BACKEND_URL });
    const res = await api.post('/auth/join', { code, username, password });
    return res.data;
  }

  // Auth APIs
  export async function signupWorkspace(workspaceName: string, username: string, password: string) {
    const api = axios.create({ baseURL: process.env.NEXT_PUBLIC_BACKEND_URL });
    const res = await api.post('/auth/signup', { workspaceName, username, password });
    return res.data;
  }

  export async function login(username: string, password: string) {
    const api = axios.create({ baseURL: process.env.NEXT_PUBLIC_BACKEND_URL });
    const res = await api.post('/auth/login', { username, password });
    return res.data;
  }