// frontend/pages/login.tsx
import { useState } from 'react';
import Router from 'next/router';
import axios from 'axios';

interface Workspace {
  workspaceId: number;
  workspaceName: string;
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<number | null>(null);
  const [showWorkspaceSelector, setShowWorkspaceSelector] = useState(false);

  async function handleLogin(e: any) {
    e.preventDefault();
    setErr('');
    setLoading(true);
    try {
      const base = process.env.NEXT_PUBLIC_BACKEND_URL;
      const payload: any = { email, password };
      if (selectedWorkspace) {
        payload.workspaceId = selectedWorkspace;
      }

      const res = await axios.post(`${base}/auth/login`, payload);

      // If workspace selection is required
      if (res.data.requiresSelection && res.data.workspaces) {
        setWorkspaces(res.data.workspaces);
        setShowWorkspaceSelector(true);
        setLoading(false);
        return;
      }

      // Login successful
      const token = res.data.token;
      localStorage.setItem('s3dash_token', token);
      localStorage.setItem('s3dash_user', JSON.stringify(res.data.user));
      localStorage.setItem('s3dash_workspace_id', res.data.user.workspaceId);

      if (res.data.user?.must_change_password) {
        Router.push('/change-password');
      } else {
        Router.push('/');
      }
    } catch (e: any) {
      console.error(e);
      setErr(e?.response?.data?.error || 'Login failed. Please check your credentials.');
      setLoading(false);
    }
  }

  async function selectWorkspace(workspaceId: number) {
    setSelectedWorkspace(workspaceId);
    setShowWorkspaceSelector(false);
    setLoading(true);
    try {
      const base = process.env.NEXT_PUBLIC_BACKEND_URL;
      const res = await axios.post(`${base}/auth/login`, {
        email,
        password,
        workspaceId,
      });

      const token = res.data.token;
      localStorage.setItem('s3dash_token', token);
      localStorage.setItem('s3dash_user', JSON.stringify(res.data.user));
      localStorage.setItem('s3dash_workspace_id', res.data.user.workspaceId);

      if (res.data.user?.must_change_password) {
        Router.push('/change-password');
      } else {
        Router.push('/');
      }
    } catch (e: any) {
      console.error(e);
      setErr(e?.response?.data?.error || 'Login failed.');
      setShowWorkspaceSelector(true);
      setLoading(false);
    }
  }

  if (showWorkspaceSelector && workspaces.length > 0) {
    return (
      <div
        style={{
          minHeight: '100vh',
          backgroundColor: '#f9fafb',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: '400px',
            backgroundColor: 'white',
            borderRadius: '12px',
            boxShadow:
              '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
            padding: '32px',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              marginBottom: '24px',
            }}
          >
            <div
              style={{
                width: '64px',
                height: '64px',
                backgroundColor: '#4f46e5',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg
                width="32"
                height="32"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                style={{ color: 'white' }}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                />
              </svg>
            </div>
          </div>

          <h2
            style={{
              fontSize: '24px',
              fontWeight: 600,
              color: '#111827',
              textAlign: 'center',
              marginBottom: '8px',
            }}
          >
            Select Workspace
          </h2>
          <p
            style={{
              fontSize: '14px',
              color: '#6b7280',
              textAlign: 'center',
              marginBottom: '32px',
            }}
          >
            You are a member of multiple workspaces
          </p>

          {err && (
            <div
              style={{
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#991b1b',
                padding: '12px 16px',
                borderRadius: '8px',
                marginBottom: '24px',
                fontSize: '14px',
              }}
            >
              {err}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {workspaces.map((ws) => (
              <button
                key={ws.workspaceId}
                onClick={() => selectWorkspace(ws.workspaceId)}
                disabled={loading}
                style={{
                  padding: '16px',
                  backgroundColor: '#f3f4f6',
                  border: '2px solid #d1d5db',
                  borderRadius: '8px',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  fontSize: '14px',
                  fontWeight: 500,
                  color: '#111827',
                  transition: 'all 0.2s',
                  opacity: loading ? 0.6 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!loading) {
                    e.currentTarget.style.backgroundColor = '#e5e7eb';
                    e.currentTarget.style.borderColor = '#4f46e5';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!loading) {
                    e.currentTarget.style.backgroundColor = '#f3f4f6';
                    e.currentTarget.style.borderColor = '#d1d5db';
                  }
                }}
              >
                {ws.workspaceName}
              </button>
            ))}
          </div>

          <button
            onClick={() => {
              setShowWorkspaceSelector(false);
              setWorkspaces([]);
              setSelectedWorkspace(null);
              setEmail('');
              setPassword('');
            }}
            style={{
              marginTop: '24px',
              width: '100%',
              padding: '12px',
              backgroundColor: 'white',
              color: '#4f46e5',
              border: '1px solid #4f46e5',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 500,
            }}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#f9fafb',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '400px',
          backgroundColor: 'white',
          borderRadius: '12px',
          boxShadow:
            '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
          padding: '32px',
        }}
      >
        {/* Logo/Icon */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            marginBottom: '24px',
          }}
        >
          <div
            style={{
              width: '64px',
              height: '64px',
              backgroundColor: '#4f46e5',
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg
              width="32"
              height="32"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              style={{ color: 'white' }}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
              />
            </svg>
          </div>
        </div>

        {/* Title */}
        <h2
          style={{
            fontSize: '24px',
            fontWeight: 600,
            color: '#111827',
            textAlign: 'center',
            marginBottom: '8px',
          }}
        >
          Welcome Back
        </h2>
        <p
          style={{
            fontSize: '14px',
            color: '#6b7280',
            textAlign: 'center',
            marginBottom: '32px',
          }}
        >
          Sign in to access S3 Explorer
        </p>

        {/* Error Message */}
        {err && (
          <div
            style={{
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#991b1b',
              padding: '12px 16px',
              borderRadius: '8px',
              marginBottom: '24px',
              fontSize: '14px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <svg
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            {err}
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: '20px' }}>
            <label
              style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: 500,
                color: '#374151',
                marginBottom: '8px',
              }}
            >
              Email
            </label>
            <input
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '14px',
                border: '1px solid #d1d5db',
                borderRadius: '8px',
                outline: 'none',
                boxSizing: 'border-box',
                transition: 'border-color 0.2s',
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = '#4f46e5')}
              onBlur={(e) => (e.currentTarget.style.borderColor = '#d1d5db')}
            />
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label
              style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: 500,
                color: '#374151',
                marginBottom: '8px',
              }}
            >
              Password
            </label>
            <input
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '14px',
                border: '1px solid #d1d5db',
                borderRadius: '8px',
                outline: 'none',
                boxSizing: 'border-box',
                transition: 'border-color 0.2s',
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = '#4f46e5')}
              onBlur={(e) => (e.currentTarget.style.borderColor = '#d1d5db')}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '12px',
              fontSize: '14px',
              fontWeight: 500,
              color: 'white',
              backgroundColor: loading ? '#9ca3af' : '#4f46e5',
              border: 'none',
              borderRadius: '8px',
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'background-color 0.2s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
            }}
            onMouseEnter={(e) => {
              if (!loading) e.currentTarget.style.backgroundColor = '#4338ca';
            }}
            onMouseLeave={(e) => {
              if (!loading) e.currentTarget.style.backgroundColor = '#4f46e5';
            }}
          >
            {loading ? (
              <>
                <div
                  style={{
                    width: '16px',
                    height: '16px',
                    border: '2px solid white',
                    borderTopColor: 'transparent',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite',
                  }}
                ></div>
                Signing in...
              </>
            ) : (
              'Sign In'
            )}
          </button>
        </form>

        {/* Signup Link */}
        <div
          style={{
            marginTop: '24px',
            padding: '16px',
            backgroundColor: '#f3f4f6',
            borderRadius: '8px',
            textAlign: 'center',
          }}
        >
          <p style={{ fontSize: '14px', color: '#6b7280', margin: '0 0 8px 0' }}>
            Don't have a workspace yet?
          </p>
          <a
            href="/signup"
            style={{
              color: '#4f46e5',
              textDecoration: 'none',
              fontWeight: 500,
              fontSize: '14px',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
            onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
          >
            Create a new workspace
          </a>
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
