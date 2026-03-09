'use client';

import { useState, useEffect } from 'react';
import type { AuthUser } from '@/lib/auth';
import { api } from '@/lib/api';
import { getBaseUrl } from '@/lib/getBaseUrl';
import { SubscriptionRow } from '@/components/SubscriptionRow';

type Props = {
  user: AuthUser;
  onClose: () => void;
  onLogout?: () => void;
  onUserUpdated: () => void;
};

export function UserSettingsView({ user, onClose, onUserUpdated }: Props) {
  const [newPassword, setNewPassword] = useState('');
  const [feedUrl, setFeedUrl] = useState('');
  const [subscriptions, setSubscriptions] = useState<Array<{ id: number; feed_url: string; enabled: boolean }>>([]);
  const [addUrl, setAddUrl] = useState('');

  useEffect(() => {
    api.icalFeed.getUrl().then(({ token }) => {
      const base = getBaseUrl().replace(/\/$/, '');
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const path = base ? `${base}/api/ical.php` : 'api/ical.php';
      setFeedUrl(`${origin}/${path}?token=${encodeURIComponent(token)}`);
    }).catch(() => setFeedUrl(''));
    api.icalSubscriptions.list().then(({ subscriptions: subs }) => setSubscriptions(subs)).catch(() => {});
  }, []);

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length >= 6) {
      api.user.changePassword(newPassword).then(() => {
        setNewPassword('');
        alert('Password updated.');
        onUserUpdated();
      }).catch(alert);
    }
  };

  const handleAddSubscription = () => {
    const url = addUrl.trim();
    if (!url) return;
    api.icalSubscriptions.add(url).then(() => {
      setAddUrl('');
      api.icalSubscriptions.list().then(({ subscriptions: subs }) => setSubscriptions(subs));
    }).catch(alert);
  };

  const handleRemove = (id: number) => {
    api.icalSubscriptions.delete(id).then(() =>
      api.icalSubscriptions.list().then(({ subscriptions: subs }) => setSubscriptions(subs))
    ).catch(alert);
  };

  return (
    <div className="settings-inner">
      <div className="settings-view-header">
        <h2>User settings</h2>
        <button type="button" className="settings-close" aria-label="Close" title="Close" onClick={onClose}>×</button>
      </div>
      <h3 style={{ marginTop: '1rem' }}>Profile</h3>
      <p>Username: {user.username}</p>

      {user.sso.length > 0 && (
        <>
          <h3 style={{ marginTop: '1rem' }}>Linked accounts</h3>
          {user.sso.map((s) => (
            <div key={s.id ?? s.provider} style={{ marginBottom: '0.5rem' }}>
              {s.provider}: {s.email}
              {s.id != null && (
                <button type="button" style={{ marginLeft: '0.5rem' }} onClick={() => {
                  const newPass = prompt('Set a new password (min 6 characters).');
                  if (newPass && newPass.length >= 6) {
                    api.user.disconnectSso(s.id as number, newPass).then(onUserUpdated).catch(alert);
                  }
                }}>
                  Disconnect
                </button>
              )}
            </div>
          ))}
        </>
      )}

      <h3 style={{ marginTop: '1rem' }}>Change password</h3>
      {user.username === 'demo' ? (
        <p style={{ color: 'var(--text-muted)' }}>Password: ***** (demo account cannot be changed)</p>
      ) : (
        <form onSubmit={handleChangePassword}>
          <label>New password <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={6} /></label>
          <button type="submit">Update password</button>
        </form>
      )}

      <h3 style={{ marginTop: '1rem' }}>Calendar feed</h3>
      <div style={{ marginBottom: '0.5rem' }}>
        <input type="text" readOnly value={feedUrl} style={{ width: '100%', maxWidth: '32rem', marginRight: '0.5rem' }} />
        <button type="button" onClick={() => navigator.clipboard.writeText(feedUrl).then(() => alert('Copied')).catch(() => alert('Could not copy'))}>Copy</button>
      </div>

      <h3 style={{ marginTop: '1rem' }}>Subscribed calendars</h3>
      <div style={{ marginBottom: '0.5rem' }}>
        <input type="url" placeholder="https://… iCal feed URL" value={addUrl} onChange={(e) => setAddUrl(e.target.value)} style={{ width: '100%', maxWidth: '32rem', marginRight: '0.5rem' }} />
        <button type="button" onClick={handleAddSubscription}>Add</button>
      </div>
      <div style={{ marginTop: '0.5rem' }}>
        {subscriptions.length === 0 && <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>No feeds. Add an iCal URL to show events on your schedule.</p>}
        {subscriptions.map((sub) => (
          <SubscriptionRow
            key={sub.id}
            sub={sub}
            onRemove={handleRemove}
            onListChange={() => api.icalSubscriptions.list().then(({ subscriptions: s }) => setSubscriptions(s))}
          />
        ))}
      </div>
    </div>
  );
}
