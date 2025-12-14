// frontend/lib/auth.ts
import axios from 'axios';

export function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('s3dash_token') : null;
}

export function getUser() {
  const t = typeof window !== 'undefined' ? localStorage.getItem('s3dash_user') : null;
  return t ? JSON.parse(t) : null;
}

export function logout() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('s3dash_token');
    localStorage.removeItem('s3dash_user');
  }
}

export function axiosWithAuth() {
  const base = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:4000';
  const instance = axios.create({ baseURL: base });
  instance.interceptors.request.use(cfg => {
    const tk = getToken();
    if (tk) cfg.headers = { ...cfg.headers, Authorization: `Bearer ${tk}` };
    return cfg;
  });
   // Response interceptor - handle 401 errors
   instance.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error.response?.status === 401) {
        // Token expired or invalid - logout and redirect to login
        logout();
        if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
          window.location.href = '/login';
        }
      }
      return Promise.reject(error);
    }
  );
  return instance;
}
