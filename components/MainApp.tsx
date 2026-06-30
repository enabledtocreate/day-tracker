'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import type { AuthUser } from '@/lib/auth';
import { fetchMe, logout, fetchSsoTransferPending, confirmSsoTransfer, cancelSsoTransfer, type SsoTransferPendingInfo } from '@/lib/auth';
import { api, setAuthRequiredHandler } from '@/lib/api';
import { LoginScreen } from '@/components/LoginScreen';
import { AppBar } from '@/components/AppBar';
import { AppPanels } from '@/components/AppPanels';
import { SsoTransferModal } from '@/components/SsoTransferModal';
import { ScheduleQueryUserGuard } from '@/lib/scheduleData';
import { DT_ID } from '@/lib/uiIdentifiers';
import { useEodAutoComplete } from '@/lib/eodAutoComplete';

export function MainApp() {
  const { setTheme } = useTheme();
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [showUserSettings, setShowUserSettings] = useState(false);
  const [showAdminSettings, setShowAdminSettings] = useState(false);
  const [sessionMessage, setSessionMessage] = useState('');
  const [ssoTransferPending, setSsoTransferPending] = useState<SsoTransferPendingInfo | null>(null);
  const [ssoTransferBusy, setSsoTransferBusy] = useState(false);
  const [ssoLinkError, setSsoLinkError] = useState('');
  const hadUserRef = useRef(false);

  const handleSessionEnded = useCallback((reason: 'login_required' | 'session_expired') => {
    setShowUserSettings(false);
    setShowAdminSettings(false);
    setUser(null);
    if (reason === 'session_expired') {
      setSessionMessage('Your session has expired. Please sign in again.');
    } else {
      setSessionMessage('');
    }
  }, []);

  useEffect(() => {
    setAuthRequiredHandler(handleSessionEnded);
    return () => setAuthRequiredHandler(null);
  }, [handleSessionEnded]);

  useEffect(() => {
    fetchMe()
      .then((data) => {
        setUser(data.user ?? null);
        setAiEnabled(data.ai_enabled !== false);
      })
      .catch(() => {
        setUser(null);
      });
  }, []);

  useEffect(() => {
    if (!user) return;
    const intervalMs = 60_000;
    const id = window.setInterval(() => {
      fetchMe()
        .then((data) => {
          if (!data.user) {
            handleSessionEnded('session_expired');
          }
        })
        .catch(() => {});
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [user?.id, handleSessionEnded]);

  // Keep settings closed only when transitioning from logged-out to logged-in (not on every user update)
  useEffect(() => {
    if (user != null) {
      if (!hadUserRef.current) {
        hadUserRef.current = true;
        setShowUserSettings(false);
        setShowAdminSettings(false);
      }
    } else {
      hadUserRef.current = false;
    }
  }, [user]);

  useEffect(() => {
    if (user === undefined || user === null) {
      setTheme('light');
      return;
    }
    api.settings
      .get()
      .then((s) => setTheme(s.ui_theme === 'light' ? 'light' : 'dark'))
      .catch(() => {});
  }, [user, setTheme]);

  // Client EOD auto-complete runner (Step 8 / §0.7). Mounts only when the
  // user is authenticated; the runner self-guards via localStorage so reloads
  // on the same day are no-ops.
  useEodAutoComplete(user !== undefined && user !== null);

  const clearSsoQueryParams = useCallback(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    let changed = false;
    for (const key of ['sso_transfer_pending', 'sso_link_error']) {
      if (params.has(key)) {
        params.delete(key);
        changed = true;
      }
    }
    if (!changed) return;
    const next = params.toString();
    const url = window.location.pathname + (next ? `?${next}` : '') + window.location.hash;
    window.history.replaceState(null, '', url);
  }, []);

  const loadSsoTransferPending = useCallback(() => {
    fetchSsoTransferPending()
      .then((pending) => setSsoTransferPending(pending))
      .catch(() => setSsoTransferPending(null));
  }, []);

  useEffect(() => {
    if (!user) return;
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const linkError = params.get('sso_link_error');
    if (linkError === 'sso_other_sso_only') {
      setSsoLinkError(
        'That sign-in is linked to an account with no password. Sign in with that provider first, set a password under Profile, then connect it here.'
      );
      setShowUserSettings(true);
    }
    if (params.get('sso_transfer_pending') === '1') {
      loadSsoTransferPending();
    }
    clearSsoQueryParams();
  }, [user, loadSsoTransferPending, clearSsoQueryParams]);

  const handleConfirmSsoTransfer = () => {
    setSsoTransferBusy(true);
    confirmSsoTransfer()
      .then((r) => {
        if (!r.ok) {
          setSsoLinkError(r.error ?? 'Could not move sign-in provider.');
          setSsoTransferPending(null);
          return;
        }
        setSsoTransferPending(null);
        setSsoLinkError('');
        fetchMe().then((data) => {
          setUser(data.user ?? null);
          setAiEnabled(data.ai_enabled !== false);
          setShowUserSettings(true);
        });
      })
      .finally(() => setSsoTransferBusy(false));
  };

  const handleCancelSsoTransfer = () => {
    cancelSsoTransfer().finally(() => setSsoTransferPending(null));
  };

  const handleLoginSuccess = () => {
    setSessionMessage('');
    setShowUserSettings(false);
    setShowAdminSettings(false);
    fetchMe().then((data) => {
      setUser(data.user ?? null);
      setAiEnabled(data.ai_enabled !== false);
    });
  };

  const handleLogout = () => {
    logout().then(() => setUser(null));
  };

  if (user === undefined) {
    return (
      <div
        id={DT_ID.sessionLoading}
        className="login-screen"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <p className="login-message">Loading…</p>
      </div>
    );
  }

  if (user === null) {
    return (
      <>
        <ScheduleQueryUserGuard userId={null} />
        <LoginScreen onSuccess={handleLoginSuccess} initialMessage={sessionMessage} />
      </>
    );
  }

  return (
    <div id={DT_ID.appShell}>
      <ScheduleQueryUserGuard userId={user.id} />
      {ssoLinkError && (
        <p className="login-message" style={{ margin: '0.5rem 1rem', maxWidth: '48rem' }}>
          {ssoLinkError}
        </p>
      )}
      {ssoTransferPending && (
        <SsoTransferModal
          pending={ssoTransferPending}
          busy={ssoTransferBusy}
          onConfirm={handleConfirmSsoTransfer}
          onCancel={handleCancelSsoTransfer}
        />
      )}
      <AppBar
        user={user}
        onUserClick={() => setShowUserSettings(true)}
        onAdminClick={() => setShowAdminSettings(true)}
        onLogout={handleLogout}
      />
      <AppPanels
        user={user}
        aiEnabled={aiEnabled}
        showUserSettings={showUserSettings}
        showAdminSettings={showAdminSettings}
        onCloseSettings={() => {
          setShowUserSettings(false);
          setShowAdminSettings(false);
        }}
        onLogout={handleLogout}
        onUserUpdated={() => fetchMe().then((data) => { setUser(data.user ?? null); setAiEnabled(data.ai_enabled !== false); setSsoLinkError(''); })}
      />
    </div>
  );
}
