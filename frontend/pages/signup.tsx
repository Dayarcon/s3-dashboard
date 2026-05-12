import { useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { signupWorkspace } from '../lib/api';

export default function SignupPage() {
  const router = useRouter();
  const [workspaceName, setWorkspaceName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [workspaceFound, setWorkspaceFound] = useState(false);
  const [existingWorkspace, setExistingWorkspace] = useState<any>(null);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!workspaceName.trim()) {
      setError('Workspace name is required');
      return;
    }

    if (!email.trim()) {
      setError('Email is required');
      return;
    }

    if (!username.trim()) {
      setError('Username is required');
      return;
    }

    if (!password) {
      setError('Password is required');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);
    try {
      const res = await signupWorkspace(workspaceName, email, username, password);

      // Check if workspace was found instead of created
      if (res.workspaceFound) {
        setWorkspaceFound(true);
        setExistingWorkspace(res.workspace);
        setLoading(false);
        return;
      }

      // Save token and workspace ID
      localStorage.setItem('s3dash_token', res.token);
      localStorage.setItem('s3dash_workspace_id', res.user.workspaceId);
      localStorage.setItem('s3dash_user', JSON.stringify(res.user));
      // Redirect to connect AWS credentials
      router.push('/connect-aws');
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || 'Signup failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  if (workspaceFound && existingWorkspace) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f9fafb' }}>
        <div style={{ width: '100%', maxWidth: '450px', padding: '24px', backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <h1 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '16px', textAlign: 'center', color: '#111827' }}>
            Workspace Found
          </h1>
          <p style={{ fontSize: '14px', color: '#6b7280', textAlign: 'center', marginBottom: '24px' }}>
            A workspace for your organization already exists!
          </p>

          <div style={{
            backgroundColor: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '24px'
          }}>
            <p style={{ fontSize: '16px', fontWeight: 600, color: '#1e40af', marginTop: 0, marginBottom: '12px' }}>
              {existingWorkspace.name}
            </p>
            <p style={{ fontSize: '14px', color: '#6b7280', marginTop: 0, marginBottom: '12px' }}>
              Contact one of the workspace admins to request access:
            </p>
            <div style={{ marginLeft: '8px' }}>
              {existingWorkspace.admins?.map((admin: any, idx: number) => (
                <div key={idx} style={{ fontSize: '13px', color: '#374151', marginBottom: '8px' }}>
                  <strong>{admin.username}</strong> ({admin.email})
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={() => router.push(`/join-workspace?email=${encodeURIComponent(email)}`)}
            style={{
              width: '100%',
              padding: '10px 16px',
              backgroundColor: '#4f46e5',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer',
              marginBottom: '12px',
            }}
          >
            Request to Join
          </button>

          <button
            onClick={() => {
              setWorkspaceFound(false);
              setExistingWorkspace(null);
              setWorkspaceName('');
              setEmail('');
              setUsername('');
              setPassword('');
              setConfirmPassword('');
            }}
            style={{
              width: '100%',
              padding: '10px 16px',
              backgroundColor: 'white',
              color: '#4f46e5',
              border: '1px solid #4f46e5',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f9fafb' }}>
      <div style={{ width: '100%', maxWidth: '400px', padding: '24px', backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '24px', textAlign: 'center', color: '#111827' }}>
          Create Workspace
        </h1>

        {error && (
          <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#fee2e2', borderRadius: '6px', color: '#991b1b', fontSize: '14px' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSignup}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', fontWeight: 500, color: '#374151' }}>
              Workspace Name
            </label>
            <input
              type="text"
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              placeholder="My Company"
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '14px',
                boxSizing: 'border-box',
              }}
              disabled={loading}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', fontWeight: 500, color: '#374151' }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@company.com"
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '14px',
                boxSizing: 'border-box',
              }}
              disabled={loading}
            />
            <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '6px', margin: '6px 0 0 0' }}>
              We'll check if your organization already exists
            </p>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', fontWeight: 500, color: '#374151' }}>
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '14px',
                boxSizing: 'border-box',
              }}
              disabled={loading}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', fontWeight: 500, color: '#374151' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter a strong password"
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '14px',
                boxSizing: 'border-box',
              }}
              disabled={loading}
            />
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', fontWeight: 500, color: '#374151' }}>
              Confirm Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm your password"
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '14px',
                boxSizing: 'border-box',
              }}
              disabled={loading}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '10px 16px',
              backgroundColor: loading ? '#9ca3af' : '#4f46e5',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: 500,
              cursor: loading ? 'not-allowed' : 'pointer',
              marginBottom: '16px',
            }}
          >
            {loading ? 'Checking...' : 'Create Workspace'}
          </button>
        </form>

        <div style={{ fontSize: '14px', color: '#6b7280', textAlign: 'center' }}>
          Already have an account?{' '}
          <Link href="/login" style={{ color: '#4f46e5', textDecoration: 'none', fontWeight: 500 }}>
            Log in
          </Link>
        </div>
      </div>
    </div>
  );
}
