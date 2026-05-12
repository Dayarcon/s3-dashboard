import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import axios from 'axios';

interface Workspace {
  id: number;
  name: string;
  admins: Array<{ id: number; email: string; username: string }>;
}

export default function JoinWorkspacePage() {
  const router = useRouter();
  const { email: initialEmail } = router.query;
  const [searchTerm, setSearchTerm] = useState('');
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(null);
  const [email, setEmail] = useState(initialEmail as string || '');
  const [username, setUsername] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSearch = async () => {
    if (!searchTerm.trim()) {
      setError('Please enter a workspace name or domain');
      return;
    }

    setSearching(true);
    setError('');
    try {
      const base = process.env.NEXT_PUBLIC_BACKEND_URL;
      const res = await axios.get(`${base}/api/workspace/search?q=${encodeURIComponent(searchTerm)}`);
      setWorkspaces(res.data);
      if (res.data.length === 0) {
        setError('No workspaces found. Create a new one instead.');
      }
    } catch (err: any) {
      setError('Failed to search workspaces');
    } finally {
      setSearching(false);
    }
  };

  const handleSelectWorkspace = (ws: any) => {
    // Fetch admins for this workspace
    setSelectedWorkspace({
      id: ws.id,
      name: ws.name,
      admins: [],
    });
    // Try to get admin info
    axios
      .get(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/workspace/${ws.id}/admins`)
      .then((res) => {
        setSelectedWorkspace({
          id: ws.id,
          name: ws.name,
          admins: res.data.admins || [],
        });
      })
      .catch(() => {
        // Admin fetch failed, but continue with workspace
        setSelectedWorkspace({
          id: ws.id,
          name: ws.name,
          admins: [],
        });
      });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!selectedWorkspace) {
      setError('Please select a workspace');
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

    setLoading(true);
    try {
      const base = process.env.NEXT_PUBLIC_BACKEND_URL;
      const res = await axios.post(`${base}/api/workspace/join-request`, {
        workspaceId: selectedWorkspace.id,
        email,
        username,
      });

      setSubmitted(true);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to submit join request');
    } finally {
      setLoading(false);
    }
  };

  if (submitted && selectedWorkspace) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f9fafb' }}>
        <div style={{ width: '100%', maxWidth: '450px', padding: '24px', backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <div style={{
              width: '64px',
              height: '64px',
              backgroundColor: '#d1fae5',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px'
            }}>
              <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: '#059669' }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 style={{ fontSize: '24px', fontWeight: 600, color: '#111827', marginBottom: '8px' }}>
              Request Submitted
            </h1>
          </div>

          <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #dcfce7', borderRadius: '8px', padding: '16px', marginBottom: '24px' }}>
            <p style={{ fontSize: '14px', color: '#15803d', marginTop: 0, marginBottom: '8px' }}>
              <strong>Success!</strong> Your request to join <strong>{selectedWorkspace.name}</strong> has been submitted.
            </p>
            <p style={{ fontSize: '13px', color: '#166534', marginTop: 0, marginBottom: 0 }}>
              The workspace admins will review your request shortly. You'll be able to access the workspace once approved.
            </p>
          </div>

          {selectedWorkspace.admins && selectedWorkspace.admins.length > 0 && (
            <div style={{ marginBottom: '24px' }}>
              <p style={{ fontSize: '13px', fontWeight: 600, color: '#374151', marginTop: 0, marginBottom: '8px' }}>
                Workspace Admins:
              </p>
              {selectedWorkspace.admins.map((admin, idx) => (
                <div key={idx} style={{ fontSize: '13px', color: '#6b7280', marginBottom: '6px' }}>
                  <strong>{admin.username}</strong> - {admin.email}
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => router.push('/login')}
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
            }}
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  if (selectedWorkspace) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f9fafb' }}>
        <div style={{ width: '100%', maxWidth: '450px', padding: '24px', backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <h1 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '8px', textAlign: 'center', color: '#111827' }}>
            Request to Join
          </h1>
          <p style={{ fontSize: '14px', color: '#6b7280', textAlign: 'center', marginBottom: '24px' }}>
            {selectedWorkspace.name}
          </p>

          {error && (
            <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#fee2e2', borderRadius: '6px', color: '#991b1b', fontSize: '14px' }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', fontWeight: 500, color: '#374151' }}>
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
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
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Choose a username"
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
                marginBottom: '12px',
              }}
            >
              {loading ? 'Submitting...' : 'Submit Request'}
            </button>

            <button
              type="button"
              onClick={() => setSelectedWorkspace(null)}
              style={{
                width: '100%',
                padding: '10px 16px',
                backgroundColor: 'white',
                color: '#4f46e5',
                border: '1px solid #4f46e5',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: 500',
                cursor: 'pointer',
              }}
            >
              Back
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f9fafb' }}>
      <div style={{ width: '100%', maxWidth: '450px', padding: '24px', backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '8px', textAlign: 'center', color: '#111827' }}>
          Find Your Workspace
        </h1>
        <p style={{ fontSize: '14px', color: '#6b7280', textAlign: 'center', marginBottom: '24px' }}>
          Search for your organization and request to join
        </p>

        {error && (
          <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#fee2e2', borderRadius: '6px', color: '#991b1b', fontSize: '14px' }}>
            {error}
          </div>
        )}

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', fontWeight: 500, color: '#374151' }}>
            Search Workspace
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Company name or domain"
              onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
              style={{
                flex: 1,
                padding: '10px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '14px',
                boxSizing: 'border-box',
              }}
              disabled={searching}
            />
            <button
              onClick={handleSearch}
              disabled={searching}
              style={{
                padding: '10px 16px',
                backgroundColor: searching ? '#9ca3af' : '#4f46e5',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: 500,
                cursor: searching ? 'not-allowed' : 'pointer',
              }}
            >
              {searching ? '...' : 'Search'}
            </button>
          </div>
        </div>

        {workspaces.length > 0 && (
          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600, color: '#374151' }}>
              Found Workspaces ({workspaces.length})
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {workspaces.map((ws) => (
                <button
                  key={ws.id}
                  onClick={() => handleSelectWorkspace(ws)}
                  style={{
                    padding: '12px',
                    backgroundColor: '#f3f4f6',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: 500,
                    color: '#111827',
                    textAlign: 'left',
                  }}
                >
                  {ws.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={() => router.push('/login')}
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
          Back to Login
        </button>
      </div>
    </div>
  );
}
