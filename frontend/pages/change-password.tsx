import { useState, useEffect } from 'react';
import { changePassword } from '../lib/api';
import Router from 'next/router';
import { getToken, checkTokenAndLogout, getUser } from '../lib/auth';

export default function ChangePasswordPage() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (checkTokenAndLogout()) return;
    if (!getToken()) Router.push('/login');
    const u = getUser();
    if (!u?.must_change_password) {
      // not required, send home
      Router.push('/');
    }
  }, []);

  async function handleSubmit(e: any) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match');
      return;
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);
    try {
      await changePassword(currentPassword, newPassword);
      // Clear must_change flag in local storage user object
      try {
        const raw = localStorage.getItem('s3dash_user');
        if (raw) {
          const parsed = JSON.parse(raw);
          parsed.must_change_password = false;
          localStorage.setItem('s3dash_user', JSON.stringify(parsed));
        }
      } catch (e) {}
      setSuccess('Password changed. Redirecting...');
      setTimeout(() => Router.push('/'), 1200);
    } catch (err: any) {
      console.error('change password failed', err);
      setError(err?.response?.data?.error || err?.message || 'Failed to change password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 480, background: 'white', padding: 24, borderRadius: 12 }}>
        <h2 style={{ marginTop: 0 }}>Change Password</h2>
        <p style={{ color: '#6b7280' }}>Your administrator has required a password change. Please set a new password now.</p>

        {error && <div style={{ background: '#fee2e2', padding: 10, borderRadius: 8, color: '#991b1b', marginBottom: 12 }}>{error}</div>}
        {success && <div style={{ background: '#ecfccb', padding: 10, borderRadius: 8, color: '#166534', marginBottom: 12 }}>{success}</div>}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 6 }}>Current password</label>
            <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #d1d5db' }} required />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 6 }}>New password</label>
            <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #d1d5db' }} required />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 6 }}>Confirm new password</label>
            <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #d1d5db' }} required />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="submit" disabled={loading} style={{ padding: '8px 14px', background: '#4f46e5', color: 'white', borderRadius: 6, border: 'none' }}>{loading ? 'Changing...' : 'Change Password'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
