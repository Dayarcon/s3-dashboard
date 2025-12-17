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

// Check if token is expired
export function isTokenExpired(token: string | null): boolean {
  if (!token) return true;
  
  try {
    // JWT tokens have 3 parts separated by dots: header.payload.signature
    const parts = token.split('.');
    if (parts.length !== 3) return true;
    
    // Decode the payload (second part)
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    
    // Check if token has expiration (exp claim is in seconds since epoch)
    if (!payload.exp) return false; // No expiration set, consider it valid
    
    // Compare expiration time with current time (in seconds)
    const currentTime = Math.floor(Date.now() / 1000);
    return payload.exp < currentTime;
  } catch (e) {
    // If we can't decode the token, consider it expired/invalid
    return true;
  }
}

// Check and handle token expiration
export function checkTokenAndLogout(): boolean {
  const token = getToken();
  if (isTokenExpired(token)) {
    logout();
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
    return true; // Token was expired and user was logged out
  }
  return false; // Token is valid
}

export function axiosWithAuth() {
  const base = process.env.NEXT_PUBLIC_BACKEND_URL;
  const instance = axios.create({ baseURL: base });
  
  // Request interceptor - check token expiration before sending request
  instance.interceptors.request.use(cfg => {
    const tk = getToken();

    // If the user is required to change password, redirect to the change-password page and cancel requests
    try {
      const u = typeof window !== 'undefined' ? localStorage.getItem('s3dash_user') : null;
      if (u) {
        const parsed = JSON.parse(u) as any;
        if (parsed?.must_change_password) {
          if (typeof window !== 'undefined' && window.location.pathname !== '/change-password') {
            window.location.href = '/change-password';
          }
          return Promise.reject(new Error('must_change_password'));
        }
      }
    } catch (e) {
      // ignore parse errors
    }

    // Check if token is expired before making the request
    if (isTokenExpired(tk)) {
      logout();
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
      // Cancel the request
      return Promise.reject(new Error('Token expired'));
    }

    if (tk) {
      cfg.headers.Authorization = `Bearer ${tk}`;
    }
    return cfg;
  });
  
  // Response interceptor - handle 401 errors (token expired/invalid on server side)
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

// Fetch current user info, permissions and allowed buckets from backend
export async function fetchMe() {
  const api = axiosWithAuth();
  const res = await api.get('/auth/me');
  return res.data;
}
