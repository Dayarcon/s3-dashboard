import { axiosWithAuth } from './auth';

export interface AuditLog {
  id: number;
  user_id: number | null;
  username: string | null;
  action: string;
  resource: string;
  details: string;
  created_at: string;
}

export interface AuditLogsResponse {
  logs: AuditLog[];
  total: number;
  limit: number;
  offset: number;
}

export async function getAuditLogs(params?: {
  limit?: number;
  offset?: number;
  userId?: number;
  action?: string;
  resource?: string;
}): Promise<AuditLogsResponse> {
  const api = axiosWithAuth();
  const res = await api.get('/api/audit', { params });
  return res.data;
}