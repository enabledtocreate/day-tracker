'use client';

import { useEffect, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import type { AuthUser } from '@/lib/auth';
import { fetchMe, logout } from '@/lib/auth';
import { api } from '@/lib/api';
import { LoginScreen } from '@/components/LoginScreen';
import { AppBar } from '@/components/AppBar';
import { AppPanels } from '@/components/AppPanels';
import { ScheduleQueryUserGuard } from '@/lib/scheduleData';
import { DT_ID } from '@/lib/uiIdentifiers';
import { useEodAutoComplete } from '@/lib/eodAutoComplete';

export function MainApp() {
  const { setTheme } = useTheme();
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [showUserSettings, setShowUserSettings] = useState(false);
  const [showAdminSettings, setShowAdminSettings] = useState(false);
  const hadUserRef = useRef(false);

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
    if (user === undefined || user === null) return;
    api.settings
      .get()
      .then((s) => setTheme(s.ui_theme === 'light' ? 'light' : 'dark'))
      .catch(() => {});
  }, [user, setTheme]);

  // Client EOD auto-complete runner (Step 8 / §0.7). Mounts only when the
  // user is authenticated; the runner self-guards via localStorage so reloads
  // on the same day are no-ops.
  useEodAutoComplete(user !== undefined && user !== null);

  const handleLoginSuccess = () => {
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
        <LoginScreen onSuccess={handleLoginSuccess} />
      </>
    );
  }

  return (
    <div id={DT_ID.appShell}>
      <ScheduleQueryUserGuard userId={user.id} />
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
        onUserUpdated={() => fetchMe().then((data) => { setUser(data.user ?? null); setAiEnabled(data.ai_enabled !== false); })}
      />
    </div>
  );
}
