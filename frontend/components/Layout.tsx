// frontend/components/Layout.tsx
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import Router, { useRouter } from 'next/router';
import { getUser, logout, fetchMe } from '../lib/auth';
import { logoutAPI } from '../lib/api';

type MeResponse = {
  user: { id: number; username: string; role: string };
  permissions: Array<{ resource: string; access: string }>;
  allowedBuckets: string[];
};

type LayoutProps = {
  /** Page title rendered in the header. */
  title?: string;
  children: React.ReactNode;
};

/**
 * Page chrome: top nav, sign-out, current user. Also acts as an auth guard —
 * if there is no token, the user is redirected to /login.
 */
export default function Layout({ title, children }: LayoutProps) {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const local = getUser();
    if (!local) {
      Router.replace('/login');
      return;
    }
    // Fetch fresh /auth/me to pick up role/permission changes since login.
    fetchMe()
      .then((data) => setMe(data))
      .catch(() => {
        // axios interceptor handles 401 -> /login
      })
      .finally(() => setReady(true));
  }, []);

  const isAdmin = me?.user.role === 'admin';
  const navItems = [
    { href: '/', label: 'Buckets' },
    ...(isAdmin
      ? [
          { href: '/users', label: 'Users' },
          { href: '/groups', label: 'Groups' },
          { href: '/audit', label: 'Audit' },
        ]
      : []),
  ];

  if (!ready) {
    return (
      <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', color: '#6b7280' }}>
        Loading...
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb' }}>
      <header
        style={{
          backgroundColor: 'white',
          borderBottom: '1px solid #e5e7eb',
          padding: '12px 24px',
          display: 'flex',
          alignItems: 'center',
          gap: '24px',
        }}
      >
        <Link href="/" style={{ textDecoration: 'none', color: '#111827' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div
              style={{
                width: '28px',
                height: '28px',
                backgroundColor: '#4f46e5',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'white' }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <span style={{ fontWeight: 600 }}>S3 Dashboard</span>
          </div>
        </Link>

        <nav style={{ display: 'flex', gap: '4px', flex: 1 }}>
          {navItems.map((item) => {
            const active = router.pathname === item.href || (item.href !== '/' && router.pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: 500,
                  color: active ? '#4f46e5' : '#374151',
                  backgroundColor: active ? '#eef2ff' : 'transparent',
                  textDecoration: 'none',
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '13px' }}>
          {me && (
            <span style={{ color: '#6b7280' }}>
              {me.user.username}
              <span
                style={{
                  marginLeft: '6px',
                  padding: '2px 8px',
                  fontSize: '11px',
                  borderRadius: '999px',
                  backgroundColor: isAdmin ? '#fef3c7' : '#e0e7ff',
                  color: isAdmin ? '#92400e' : '#3730a3',
                }}
              >
                {me.user.role}
              </span>
            </span>
          )}
          <button
            onClick={async () => {
              await logoutAPI();
              logout();
              Router.replace('/login');
            }}
            style={{
              padding: '6px 12px',
              fontSize: '13px',
              borderRadius: '6px',
              border: '1px solid #d1d5db',
              backgroundColor: 'white',
              cursor: 'pointer',
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      <main style={{ maxWidth: '1280px', margin: '0 auto', padding: '24px' }}>
        {title && (
          <h1 style={{ fontSize: '22px', fontWeight: 600, color: '#111827', marginBottom: '16px' }}>
            {title}
          </h1>
        )}
        {children}
      </main>
    </div>
  );
}
