'use client';

import { useState, useRef, useEffect } from 'react';
import type { AuthUser } from '@/lib/auth';
import { getBaseUrl } from '@/lib/getBaseUrl';
import { DT } from '@/lib/uiIdentifiers';

type Props = {
  user: AuthUser;
  onUserClick: () => void;
  onAdminClick: () => void;
  onLogout: () => void;
};

export function AppBar({ user, onUserClick, onAdminClick, onLogout }: Props) {
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!userMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [userMenuOpen]);

  const faviconSrc = getBaseUrl() + 'favicon.ico';
  return (
    <header className={`app-bar ${DT.appBar}`} id="app-bar">
      <div className="app-bar-left">
        <img src={faviconSrc} alt="" className="app-bar-favicon" />
        <h1 className="app-bar-title">Day Tracker</h1>
      </div>
      <div className="app-bar-right" style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        {user.is_admin && (
          <button type="button" className="app-bar-icon app-bar-admin-icon" title="Admin settings" aria-label="Admin settings" onClick={onAdminClick}>
            ⚙
          </button>
        )}
        <div ref={menuRef} style={{ position: 'relative' }}>
          <button
            type="button"
            className="app-bar-icon app-bar-user-icon"
            title="User menu"
            aria-label="User menu"
            aria-expanded={userMenuOpen}
            aria-haspopup="true"
            onClick={() => setUserMenuOpen((o) => !o)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="8" r="4" />
              <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
            </svg>
          </button>
          {userMenuOpen && (
            <div
              role="menu"
              className="app-bar-user-menu"
              style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: '0.25rem',
                minWidth: '10rem',
                background: 'var(--surface-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                padding: '0.25rem 0',
                zIndex: 1000,
              }}
            >
              <button
                type="button"
                role="menuitem"
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', padding: '0.5rem 0.75rem', border: 'none', background: 'none', color: 'var(--text)', cursor: 'pointer', fontSize: '0.9rem', textAlign: 'left' }}
                onClick={() => { onUserClick(); setUserMenuOpen(false); }}
              >
                <span aria-hidden>⚙</span> Settings
              </button>
              <button
                type="button"
                role="menuitem"
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', padding: '0.5rem 0.75rem', border: 'none', background: 'none', color: 'var(--text)', cursor: 'pointer', fontSize: '0.9rem', textAlign: 'left' }}
                onClick={() => { onLogout(); setUserMenuOpen(false); }}
              >
                <span aria-hidden>⎋</span> Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
