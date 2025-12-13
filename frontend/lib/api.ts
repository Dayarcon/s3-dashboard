import { axiosWithAuth } from './auth';

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
  