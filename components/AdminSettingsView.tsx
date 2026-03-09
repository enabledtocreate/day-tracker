'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { AuthUser } from '@/lib/auth';
import { api } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';

type Props = { user: AuthUser; onClose: () => void };

type AdminSettings = {
  debug: boolean;
  ai_enabled: boolean;
  ical_fetch_timeout: number;
  ical_subscriptions_enabled?: boolean;
  ical_save_folder?: string;
  ical_save_folder_local?: string;
  ical_save_last_fetch?: boolean;
  ical_interval_fetch?: boolean;
  ical_event_range_days?: number;
  ical_omit_uids?: string;
};

type AdminUser = {
  id: number;
  username: string;
  db_name: string;
  force_password_reset: boolean;
  is_admin: boolean;
  created_at: string;
  sso_providers: string[];
};

const ADMIN_CATEGORIES = [
  { id: 'app', label: 'App', sub: [{ id: 'app.general', label: 'General' }] },
  { id: 'ical', label: 'iCal', sub: [{ id: 'ical.fetch_options', label: 'Fetch options' }, { id: 'ical.view_last_fetch', label: 'View last fetch' }] },
  { id: 'users', label: 'Users', sub: [{ id: 'users', label: 'Users' }] },
  { id: 'logs', label: 'Logs', sub: [{ id: 'logs', label: 'Error log' }] },
] as const;

type SubcategoryId = 'app.general' | 'ical.fetch_options' | 'ical.view_last_fetch' | 'users' | 'logs';

export function AdminSettingsView({ user, onClose }: Props) {
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedSubcategory, setSelectedSubcategory] = useState<SubcategoryId>('app.general');
  const [logsOpen, setLogsOpen] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [lastFetch, setLastFetch] = useState<{
    path: string | null;
    content: string | null;
    save_folder: string;
    sync_state: Record<string, unknown> | null;
    parsed_events: Array<{ uid: string; title: string; start: string; end: string; allDay: boolean }> | null;
    parse_range: { from: string; to: string } | null;
  } | null>(null);
  const [feedModalOpen, setFeedModalOpen] = useState(false);
  const [feedModalView, setFeedModalView] = useState<'raw' | 'parsed'>('raw');
  const [logSearch, setLogSearch] = useState('');
  const [logMatchIndex, setLogMatchIndex] = useState(0);
  const logContentRef = useRef<HTMLDivElement>(null);
  const logMatches = useMemo(() => {
    const q = logSearch.trim();
    if (!q) return [];
    const lower = q.toLowerCase();
    return logLines.map((line, i) => (line.toLowerCase().includes(lower) ? i : -1)).filter((i) => i >= 0);
  }, [logLines, logSearch]);
  useEffect(() => {
    if (logsOpen && logContentRef.current) {
      logContentRef.current.scrollTop = logContentRef.current.scrollHeight;
    }
  }, [logsOpen, logLines]);
  useEffect(() => {
    if (!logsOpen) return;
    if (logMatches.length === 0) return;
    const idx = logMatchIndex >= logMatches.length ? 0 : logMatchIndex;
    const el = logContentRef.current?.querySelector(`[data-log-line="${logMatches[idx]}"]`);
    (el as HTMLElement)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [logsOpen, logMatchIndex, logMatches]);

  const loadSettings = useCallback(() => {
    api.admin.getSettings().then(setSettings).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, []);
  const loadUsers = useCallback(() => {
    api.admin.getUsers().then((r) => setUsers(r.users)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!user?.is_admin) return;
    loadSettings();
    loadUsers();
  }, [user?.is_admin, loadSettings, loadUsers]);

  const loadLogs = () => {
    api.admin.getErrorLog().then((r) => setLogLines(r.lines)).catch(() => setLogLines(['Could not load log.']));
  };

  const loadLastFetch = () => {
    api.admin
      .getIcalLastFetch()
      .then((r) =>
        setLastFetch({
          path: r.path,
          content: r.content,
          save_folder: r.save_folder,
          sync_state: r.sync_state ?? null,
          parsed_events: r.parsed_events ?? null,
          parse_range: r.parse_range ?? null,
        })
      )
      .catch(() =>
        setLastFetch({
          path: null,
          content: null,
          save_folder: '',
          sync_state: null,
          parsed_events: null,
          parse_range: null,
        })
      );
  };

  if (error) {
    return (
      <div className="settings-inner">
        <div className="settings-view-header">
          <h2>Admin settings</h2>
          <button type="button" className="settings-close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <p>{error}</p>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="settings-inner">
        <div className="settings-view-header">
          <h2>Admin settings</h2>
          <button type="button" className="settings-close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <p>Loading…</p>
      </div>
    );
  }

  return (
    <div className="settings-inner" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div className="settings-view-header">
        <h2>Admin settings</h2>
        <button type="button" className="settings-close" aria-label="Close" title="Close" onClick={onClose}>×</button>
      </div>
      <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: '1rem' }}>
        <nav className="admin-settings-nav" aria-label="Admin categories" style={{ flex: '0 0 180px', display: 'flex', flexDirection: 'column', gap: '0.25rem', borderRight: '1px solid var(--border)', paddingRight: '1rem' }}>
          {ADMIN_CATEGORIES.map((cat) => (
            <div key={cat.id}>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.25rem' }}>{cat.label}</div>
              {cat.sub.map((sub) => (
                <button
                  key={sub.id}
                  type="button"
                  className={'admin-settings-nav-item' + (selectedSubcategory === sub.id ? ' active' : '')}
                  onClick={() => setSelectedSubcategory(sub.id as SubcategoryId)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '0.4rem 0.5rem',
                    marginBottom: '0.2rem',
                    border: 'none',
                    borderRadius: 4,
                    background: selectedSubcategory === sub.id ? 'var(--accent-bg)' : 'transparent',
                    color: selectedSubcategory === sub.id ? 'var(--accent)' : 'var(--text)',
                    cursor: 'pointer',
                    fontSize: '0.9rem',
                  }}
                >
                  {sub.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
          {selectedSubcategory === 'app.general' && (
            <AdminAppGeneral settings={settings} setSettings={setSettings} />
          )}
          {selectedSubcategory === 'ical.fetch_options' && (
            <AdminIcalFetchOptions settings={settings} setSettings={setSettings} />
          )}
          {selectedSubcategory === 'ical.view_last_fetch' && (
            <AdminIcalViewLastFetch
              lastFetch={lastFetch}
              onLoad={loadLastFetch}
              saveLastFetchOn={settings?.ical_save_last_fetch === true}
              onOpenFeedModal={() => setFeedModalOpen(true)}
              icalEventRangeDays={settings?.ical_event_range_days ?? 365}
              debug={settings?.debug === true}
            />
          )}
          {selectedSubcategory === 'users' && (
            <AdminUsers users={users} onUpdate={loadUsers} />
          )}
          {selectedSubcategory === 'logs' && (
            <AdminLogs onViewLogs={() => { setLogsOpen(true); loadLogs(); }} />
          )}
        </div>
      </div>

      <Modal
        open={logsOpen}
        onClose={() => { setLogsOpen(false); setLogSearch(''); }}
        title="Error log"
        aria-label="Error log"
        actions={
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flex: 1, minWidth: 0 }}>
              <span style={{ flexShrink: 0 }} aria-hidden>🔍</span>
              <input
                type="text"
                placeholder="Search…"
                value={logSearch}
                onChange={(e) => { setLogSearch(e.target.value); setLogMatchIndex(0); }}
                style={{ flex: '1 1 8rem', minWidth: 0, padding: '0.25rem 0.4rem', fontSize: '0.9rem' }}
              />
              {logMatches.length > 0 && (
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', flexShrink: 0 }}>
                  <Button
                    onClick={() => setLogMatchIndex((i) => (i <= 0 ? logMatches.length - 1 : i - 1))}
                    title="Previous match"
                  >
                    ↑
                  </Button>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    {logMatchIndex + 1}/{logMatches.length}
                  </span>
                  <Button
                    onClick={() => setLogMatchIndex((i) => (i >= logMatches.length - 1 ? 0 : i + 1))}
                    title="Next match"
                  >
                    ↓
                  </Button>
                </span>
              )}
            </div>
            <Button onClick={loadLogs}>Refresh</Button>
            <Button onClick={() => { setLogsOpen(false); setLogSearch(''); }} aria-label="Close">×</Button>
          </>
        }
      >
        <div ref={logContentRef} style={{ maxHeight: '60vh', overflow: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '0.85rem' }}>
          {logLines.length ? (
            logLines.map((line, i) => {
              const q = logSearch.trim();
              const content = q
                ? (() => {
                    const parts = line.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
                    return parts.map((p, j) => (p.toLowerCase() === q.toLowerCase() ? <mark key={j}>{p}</mark> : p));
                  })()
                : line;
              return (
                <div key={i} data-log-line={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {content}
                </div>
              );
            })
          ) : (
            'No log entries.'
          )}
        </div>
      </Modal>

      <Modal
        open={feedModalOpen}
        onClose={() => { setFeedModalOpen(false); setFeedModalView('raw'); }}
        title="Last fetch feed"
        aria-label="Last fetch feed"
        actions={
          <>
            <Button onClick={() => setFeedModalView('raw')}>Raw data</Button>
            <Button onClick={() => setFeedModalView('parsed')}>Parsed (saved to DB)</Button>
            <Button onClick={() => { setFeedModalOpen(false); setFeedModalView('raw'); }} aria-label="Close">×</Button>
          </>
        }
      >
        {lastFetch?.parse_range && (
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
            Parsed for dates: {lastFetch.parse_range.from} to {lastFetch.parse_range.to}
          </p>
        )}
        {feedModalView === 'raw' ? (
          <pre style={{ margin: 0, padding: '0.75rem', background: 'var(--surface-elevated)', border: '1px solid var(--border)', borderRadius: 4, fontSize: '0.8rem', overflow: 'auto', maxHeight: '50vh', whiteSpace: 'pre-wrap' }}>
            {lastFetch?.content ?? 'No content.'}
          </pre>
        ) : (
          <div style={{ overflow: 'auto', maxHeight: '50vh' }}>
            {lastFetch?.parsed_events && lastFetch.parsed_events.length > 0 ? (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '0.35rem', borderBottom: '1px solid var(--border)' }}>Title</th>
                    <th style={{ textAlign: 'left', padding: '0.35rem', borderBottom: '1px solid var(--border)' }}>Start</th>
                    <th style={{ textAlign: 'left', padding: '0.35rem', borderBottom: '1px solid var(--border)' }}>End</th>
                    <th style={{ textAlign: 'left', padding: '0.35rem', borderBottom: '1px solid var(--border)' }}>All day</th>
                  </tr>
                </thead>
                <tbody>
                  {lastFetch.parsed_events.map((ev, i) => (
                    <tr key={ev.uid + i}>
                      <td style={{ padding: '0.35rem', borderBottom: '1px solid var(--border-subtle)' }}>{ev.title}</td>
                      <td style={{ padding: '0.35rem', borderBottom: '1px solid var(--border-subtle)' }}>{ev.start}</td>
                      <td style={{ padding: '0.35rem', borderBottom: '1px solid var(--border-subtle)' }}>{ev.end}</td>
                      <td style={{ padding: '0.35rem', borderBottom: '1px solid var(--border-subtle)' }}>{ev.allDay ? 'Yes' : 'No'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p style={{ color: 'var(--text-muted)' }}>No parsed events for this range.</p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function AdminAppGeneral({ settings, setSettings }: { settings: AdminSettings; setSettings: React.Dispatch<React.SetStateAction<AdminSettings | null>> }) {
  const [migrateLoading, setMigrateLoading] = useState(false);
  const [migrateResult, setMigrateResult] = useState<{ ok: boolean; applied: string[] } | null>(null);

  const handleCheckbox = (key: 'debug' | 'ai_enabled', value: boolean, apiCall: () => Promise<unknown>) => {
    const prev = settings[key];
    setSettings((s) => (s ? { ...s, [key]: value } : s));
    apiCall().catch(() => {
      setSettings((s) => (s ? { ...s, [key]: prev } : s));
      alert('Failed to save. Setting reverted.');
    });
  };

  const handleRunMigrations = () => {
    setMigrateLoading(true);
    setMigrateResult(null);
    api.admin
      .runMigrations()
      .then((res) => {
        setMigrateResult(res);
      })
      .catch((e) => {
        setMigrateResult({ ok: false, applied: [] });
        alert(e instanceof Error ? e.message : 'Migration failed');
      })
      .finally(() => setMigrateLoading(false));
  };

  const handleRefreshConfirm = () => {
    setMigrateResult(null);
    window.location.reload();
  };

  return (
    <>
      <h3 style={{ marginTop: 0 }}>App settings</h3>
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }} htmlFor="admin-debug">
        <input
          id="admin-debug"
          type="checkbox"
          checked={settings.debug}
          onChange={(e) => handleCheckbox('debug', e.target.checked, () => api.admin.setDebug(e.target.checked))}
        />
        Debug mode
      </label>
      <label style={{ display: 'block', marginTop: '0.5rem' }} htmlFor="admin-ai-enabled">
        <input
          id="admin-ai-enabled"
          type="checkbox"
          checked={settings.ai_enabled}
          onChange={(e) => handleCheckbox('ai_enabled', e.target.checked, () => api.admin.setAiEnabled(e.target.checked))}
        />
        {' '}AI chat panel enabled
      </label>

      <div className="admin-section" style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
        <h4 style={{ marginTop: 0, marginBottom: '0.5rem' }}>Database migrations</h4>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
          Run pending schema migrations for your user database.
        </p>
        <Button onClick={handleRunMigrations} disabled={migrateLoading}>
          {migrateLoading ? 'Running…' : 'Run migrations'}
        </Button>
        {migrateResult && (
          <div style={{ marginTop: '0.75rem' }}>
            <p style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>
              {migrateResult.ok
                ? migrateResult.applied.length === 0
                  ? 'No pending migrations. Schema is up to date.'
                  : `Applied: ${migrateResult.applied.join(', ')}`
                : 'Migration failed.'}
            </p>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Refresh the page?</p>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <Button onClick={handleRefreshConfirm}>Yes, refresh</Button>
              <Button onClick={() => setMigrateResult(null)}>No</Button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function AdminIcalFetchOptions({ settings, setSettings }: { settings: AdminSettings; setSettings: React.Dispatch<React.SetStateAction<AdminSettings | null>> }) {
  return (
    <>
      <h3 style={{ marginTop: 0 }}>iCal fetch options</h3>
      <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>Configure how subscribed calendar feeds (e.g. Google Calendar) are fetched.</p>

      <label style={{ display: 'block', marginBottom: '0.5rem' }}>
        iCal feed fetch timeout (seconds, 5–300):{' '}
        <input
          type="number"
          min={5}
          max={300}
          value={settings.ical_fetch_timeout ?? 60}
          style={{ width: '4rem', marginLeft: '0.25rem' }}
          onChange={(e) => {
            const v = Math.max(5, Math.min(300, parseInt(e.target.value, 10) || 60));
            api.admin.setIcalFetchTimeout(v).then(() => setSettings((s) => (s ? { ...s, ical_fetch_timeout: v } : s))).catch(alert);
          }}
        />
      </label>

      <label style={{ display: 'block', marginBottom: '0.5rem' }}>
        Show events from today up to (days, 1–732):{' '}
        <input
          type="number"
          min={1}
          max={732}
          value={settings.ical_event_range_days ?? 365}
          style={{ width: '4rem', marginLeft: '0.25rem' }}
          onChange={(e) => {
            const v = Math.max(1, Math.min(732, parseInt(e.target.value, 10) || 365));
            setSettings((s) => (s ? { ...s, ical_event_range_days: v } : s));
          }}
          onBlur={(e) => {
            const v = Math.max(1, Math.min(732, parseInt(e.target.value, 10) || 365));
            api.admin.setIcalEventRangeDays(v).then(() => setSettings((s) => (s ? { ...s, ical_event_range_days: v } : s))).catch(alert);
          }}
        />
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>Sync and display iCal events on schedule/calendar within this many days ahead.</span>
      </label>

      <label style={{ display: 'block', marginBottom: '0.5rem' }}>
        Omit iCal events by UID (one per line or comma-separated; matched by exact UID; flexible for future changes):
        <textarea
          rows={4}
          value={settings.ical_omit_uids ?? ''}
          placeholder="e.g. event-uid-123@google.com"
          style={{ display: 'block', width: '100%', maxWidth: '32rem', marginTop: '0.25rem', padding: '0.35rem', fontFamily: 'inherit', fontSize: '0.9rem' }}
          onChange={(e) => setSettings((s) => (s ? { ...s, ical_omit_uids: e.target.value } : s))}
          onBlur={(e) => {
            const v = e.target.value.trim();
            api.admin.setIcalOmitUids(v).then(() => setSettings((s) => (s ? { ...s, ical_omit_uids: v } : s))).catch(alert);
          }}
        />
      </label>

      <label style={{ display: 'block', marginBottom: '0.5rem' }}>
        Save folder (local path under app data):{' '}
        <input
          type="text"
          value={settings.ical_save_folder ?? settings.ical_save_folder_local ?? 'ical_fetches'}
          onChange={(e) => setSettings((s) => (s ? { ...s, ical_save_folder: e.target.value } : s))}
          onBlur={(e) => {
            const v = e.target.value.trim() || 'ical_fetches';
            api.admin.setIcalSaveFolder(v).catch(alert);
          }}
          placeholder="ical_fetches"
          style={{ width: '100%', maxWidth: '24rem', padding: '0.3rem', marginTop: '0.25rem' }}
        />
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>Path is relative to app data directory only.</span>
      </label>

      <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.5rem' }} htmlFor="admin-ical-save-last-fetch">
        <input
          id="admin-ical-save-last-fetch"
          type="checkbox"
          checked={!!settings.ical_save_last_fetch}
          onChange={(e) => {
            const next = e.target.checked;
            const prev = !!settings.ical_save_last_fetch;
            setSettings((s) => (s ? { ...s, ical_save_last_fetch: next } : s));
            api.admin.setIcalSaveLastFetch(next).catch(() => {
              setSettings((s) => (s ? { ...s, ical_save_last_fetch: prev } : s));
              alert('Failed to save. Setting reverted.');
            });
          }}
        />
        Save last fetch (keep one file for debugging; when off, file is deleted after parsing)
      </label>

      <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.5rem' }} htmlFor="admin-ical-interval-fetch">
        <input
          id="admin-ical-interval-fetch"
          type="checkbox"
          checked={settings.ical_interval_fetch !== false}
          onChange={(e) => {
            const next = e.target.checked;
            const prev = settings.ical_interval_fetch !== false;
            setSettings((s) => (s ? { ...s, ical_interval_fetch: next } : s));
            api.admin.setIcalIntervalFetch(next).catch(() => {
              setSettings((s) => (s ? { ...s, ical_interval_fetch: prev } : s));
              alert('Failed to save. Setting reverted.');
            });
          }}
        />
        Fetch iCal on interval (when on Today tab; when off, fetch only on page refresh)
      </label>

      <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.5rem' }} htmlFor="admin-ical-subscriptions-enabled">
        <input
          id="admin-ical-subscriptions-enabled"
          type="checkbox"
          checked={settings.ical_subscriptions_enabled !== false}
          onChange={(e) => {
            const next = e.target.checked;
            const prev = settings.ical_subscriptions_enabled !== false;
            setSettings((s) => (s ? { ...s, ical_subscriptions_enabled: next } : s));
            api.admin.setIcalSubscriptionsEnabled(next).catch(() => {
              setSettings((s) => (s ? { ...s, ical_subscriptions_enabled: prev } : s));
              alert('Failed to save. Setting reverted.');
            });
          }}
        />
        Subscribed calendars enabled (fetch external iCal feeds)
      </label>
    </>
  );
}

function AdminIcalViewLastFetch({
  lastFetch,
  onLoad,
  saveLastFetchOn,
  onOpenFeedModal,
  icalEventRangeDays = 365,
  debug = false,
}: {
  lastFetch: {
    path: string | null;
    content: string | null;
    save_folder: string;
    sync_state: Record<string, unknown> | null;
    parsed_events: Array<{ uid: string; title: string; start: string; end: string; allDay: boolean }> | null;
    parse_range: { from: string; to: string } | null;
  } | null;
  onLoad: () => void;
  saveLastFetchOn: boolean;
  onOpenFeedModal: () => void;
  icalEventRangeDays?: number;
  debug?: boolean;
}) {
  const [forceSyncLoading, setForceSyncLoading] = useState(false);
  const [clearLoading, setClearLoading] = useState(false);
  const handleForceSync = useCallback(() => {
    const now = new Date();
    const from = now.toISOString().slice(0, 10);
    const days = Math.max(1, Math.min(732, icalEventRangeDays ?? 365));
    const to = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    setForceSyncLoading(true);
    api.icalEvents
      .get(from, to, { force_sync: true })
      .then(() => onLoad())
      .finally(() => setForceSyncLoading(false));
  }, [onLoad, icalEventRangeDays]);
  return (
    <>
      <h3 style={{ marginTop: 0 }}>iCal sync state (last_fetch.json)</h3>
      <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
        Current sync state and last saved fetch. State is updated at each step: downloading → parsing → saving → synced (or error). Use this to confirm the server is fetching, parsing, and saving to the database.
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <Button onClick={onLoad}>Load sync state</Button>
        <Button onClick={handleForceSync} disabled={forceSyncLoading}>
          {forceSyncLoading ? 'Syncing…' : 'Force sync'}
        </Button>
        {saveLastFetchOn && lastFetch?.content != null && lastFetch.content !== '' && (
          <Button onClick={onOpenFeedModal}>View feed (raw + parsed)</Button>
        )}
        {debug && saveLastFetchOn && (
          <Button
            onClick={() => {
              setClearLoading(true);
              api.admin.clearIcalFeedEvents().then(() => {}).catch(alert).finally(() => setClearLoading(false));
            }}
            disabled={clearLoading}
          >
            {clearLoading ? 'Clearing…' : 'Clear iCal feed events'}
          </Button>
        )}
      </div>
      {lastFetch && (
        <div style={{ marginTop: '1rem' }}>
          {lastFetch.sync_state && Object.keys(lastFetch.sync_state).length > 0 ? (
            <div style={{ marginBottom: '1rem' }}>
              <h4 style={{ marginTop: 0, marginBottom: '0.5rem' }}>Sync state</h4>
              <dl style={{ fontSize: '0.9rem', margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.25rem 1rem' }}>
                {['state', 'subscription_id', 'feed_url', 'range_from', 'range_to', 'parsed_count', 'bytes_fetched', 'saved_at', 'updated_at', 'message', 'error'].map(
                  (key) => {
                    const v = lastFetch.sync_state![key];
                    if (v === undefined || v === null) return null;
                    return (
                      <div key={key} style={{ gridColumn: '1 / -1', display: 'contents' }}>
                        <dt style={{ margin: 0, color: 'var(--text-muted)' }}>{key}</dt>
                        <dd style={{ margin: 0, wordBreak: 'break-all' }}>{String(v)}</dd>
                      </div>
                    );
                  }
                )}
              </dl>
              <pre style={{ marginTop: '0.5rem', padding: '0.75rem', background: 'var(--surface-elevated)', border: '1px solid var(--border)', borderRadius: 4, fontSize: '0.75rem', overflow: 'auto', maxHeight: '20vh', whiteSpace: 'pre-wrap' }}>
                {JSON.stringify(lastFetch.sync_state, null, 2)}
              </pre>
            </div>
          ) : (
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>No sync state yet. Trigger a sync (open Today tab or click Sync iCal) then load again.</p>
          )}
          <p style={{ fontSize: '0.9rem' }}><strong>Save folder:</strong> {lastFetch.save_folder || '—'}</p>
          <p style={{ fontSize: '0.9rem' }}><strong>Last saved path:</strong> {lastFetch.path || '—'}</p>
          {lastFetch.content != null && lastFetch.content !== '' && !saveLastFetchOn && (
            <pre style={{ marginTop: '0.5rem', padding: '0.75rem', background: 'var(--surface-elevated)', border: '1px solid var(--border)', borderRadius: 4, fontSize: '0.8rem', overflow: 'auto', maxHeight: '40vh', whiteSpace: 'pre-wrap' }}>
              {lastFetch.content}
            </pre>
          )}
        </div>
      )}
    </>
  );
}

function AdminUsers({ users, onUpdate }: { users: AdminUser[]; onUpdate: () => void }) {
  return (
    <>
      <h3 style={{ marginTop: 0 }}>Users</h3>
      <table style={{ width: '100%', marginTop: '0.5rem', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Username</th>
            <th style={{ textAlign: 'left' }}>SSO</th>
            <th style={{ textAlign: 'left' }}>Force password reset</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.username}</td>
              <td>{u.sso_providers?.length ? u.sso_providers.join(', ') : '—'}</td>
              <td>
                {u.sso_providers?.length === 0 ? (
                  <input
                    type="checkbox"
                    checked={u.force_password_reset}
                    onChange={(e) =>
                      api.admin.setForcePasswordReset(u.id, e.target.checked).then(onUpdate).catch(alert)
                    }
                  />
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function AdminLogs({ onViewLogs }: { onViewLogs: () => void }) {
  return (
    <>
      <h3 style={{ marginTop: 0 }}>Error log</h3>
      <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Application log for debugging.</p>
      <Button onClick={onViewLogs}>View logs</Button>
    </>
  );
}
