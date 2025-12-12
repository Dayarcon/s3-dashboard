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
