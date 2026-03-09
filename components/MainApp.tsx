'use client';

import { useEffect, useRef, useState } from 'react';
import type { AuthUser } from '@/lib/auth';
import { fetchMe, logout } from '@/lib/auth';
import { LoginScreen } from '@/components/LoginScreen';
import { AppBar } from '@/components/AppBar';
import { AppPanels } from '@/components/AppPanels';

export function MainApp() {
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
      <div className="login-screen" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p className="login-message">Loading…</p>
      </div>
    );
  }

  if (user === null) {
    return <LoginScreen onSuccess={handleLoginSuccess} />;
  }

  return (
    <>
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
    </>
  );
}
