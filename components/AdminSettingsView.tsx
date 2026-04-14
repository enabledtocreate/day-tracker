'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { AuthUser } from '@/lib/auth';
import { api } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { DT } from '@/lib/uiIdentifiers';

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
  ical_use_cron_job?: boolean;
  ical_sync_interval_minutes?: number;
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
  type IcalSubSyncRow = {
    subscription_id: number;
    feed_url: string | null;
    sync_state: string | null;
    message: string | null;
    error: string | null;
    bytes_fetched: number | null;
    parsed_count: number | null;
    range_from: string | null;
    range_to: string | null;
    updated_at: string | null;
    path: string | null;
    content: string | null;
    parsed_events: Array<{ uid: string; title: string; start: string; end: string; allDay: boolean }> | null;
    parse_range: { from: string; to: string };
  };
  const [lastFetch, setLastFetch] = useState<{
    path: string | null;
    content: string | null;
    save_folder: string;
    sync_state: Record<string, unknown> | null;
    parsed_events: Array<{ uid: string; title: string; start: string; end: string; allDay: boolean }> | null;
    parse_range: { from: string; to: string } | null;
    subscriptions?: IcalSubSyncRow[];
  } | null>(null);
  const [feedModalOpen, setFeedModalOpen] = useState(false);
  const [feedModalSubId, setFeedModalSubId] = useState<number | null>(null);
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
          subscriptions: r.subscriptions,
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
          subscriptions: undefined,
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
      <div className={`settings-inner ${DT.adminSettingsInner}`}>
        <div className="settings-view-header">
          <h2>Admin settings</h2>
          <button type="button" className="settings-close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <p>Loading…</p>
      </div>
    );
  }

  return (
    <div className={`settings-inner ${DT.adminSettingsInner}`} style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
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
              onOpenFeedModal={(subscriptionId) => {
                setFeedModalSubId(subscriptionId);
                setFeedModalOpen(true);
              }}
              useCronJob={settings?.ical_use_cron_job === true}
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
        onClose={() => { setFeedModalOpen(false); setFeedModalView('raw'); setFeedModalSubId(null); }}
        title="Saved fetch feed"
        aria-label="Saved fetch feed"
        actions={
          <>
            <Button onClick={() => setFeedModalView('raw')}>Raw data</Button>
            <Button onClick={() => setFeedModalView('parsed')}>Parsed (preview)</Button>
            <Button onClick={() => { setFeedModalOpen(false); setFeedModalView('raw'); setFeedModalSubId(null); }} aria-label="Close">×</Button>
          </>
        }
      >
        {(() => {
          const subs = lastFetch?.subscriptions;
          const row =
            subs && subs.length > 0
              ? subs.find((s) => s.subscription_id === feedModalSubId) ?? subs[0]
              : null;
          const parseRange = row?.parse_range ?? lastFetch?.parse_range;
          const modalContent = row?.content ?? lastFetch?.content;
          const modalParsed = row?.parsed_events ?? lastFetch?.parsed_events;
          return (
            <>
              {subs && subs.length > 1 && (
                <label htmlFor="admin-ical-feed-modal-sub" style={{ display: 'block', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
                  Calendar:{' '}
                  <select
                    id="admin-ical-feed-modal-sub"
                    aria-label="Calendar subscription for saved fetch preview"
                    value={feedModalSubId ?? subs[0]?.subscription_id ?? ''}
                    onChange={(e) => setFeedModalSubId(Number(e.target.value))}
                    style={{ marginLeft: '0.35rem', padding: '0.25rem', maxWidth: '100%' }}
                  >
                    {subs.map((s) => (
                      <option key={s.subscription_id} value={s.subscription_id}>
                        #{s.subscription_id} {s.feed_url ? s.feed_url.slice(0, 48) + (s.feed_url.length > 48 ? '…' : '') : ''}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {parseRange && (
                <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                  Parsed for dates: {parseRange.from} to {parseRange.to}
                </p>
              )}
              {feedModalView === 'raw' ? (
                <pre style={{ margin: 0, padding: '0.75rem', background: 'var(--surface-elevated)', border: '1px solid var(--border)', borderRadius: 4, fontSize: '0.8rem', overflow: 'auto', maxHeight: '50vh', whiteSpace: 'pre-wrap' }}>
                  {modalContent ?? 'No content.'}
                </pre>
              ) : (
                <div style={{ overflow: 'auto', maxHeight: '50vh' }}>
                  {modalParsed && modalParsed.length > 0 ? (
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
                        {modalParsed.map((ev, i) => (
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
            </>
          );
        })()}
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

      <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '1rem' }} htmlFor="admin-ical-subscriptions-enabled">
        <input
          id="admin-ical-subscriptions-enabled"
          type="checkbox"
          checked={settings.ical_subscriptions_enabled !== false}
          onChange={(e) => {
            const next = e.target.checked;
            const prevSubs = settings.ical_subscriptions_enabled !== false;
            const revertCron = settings.ical_use_cron_job === true;
            const revertInterval = settings.ical_interval_fetch !== false;
            if (!next) {
              setSettings((s) =>
                s
                  ? {
                      ...s,
                      ical_subscriptions_enabled: false,
                      ical_use_cron_job: false,
                      ical_interval_fetch: false,
                    }
                  : s
              );
              api.admin.setIcalSubscriptionsEnabled(false).catch(() => {
                setSettings((s) =>
                  s
                    ? {
                        ...s,
                        ical_subscriptions_enabled: prevSubs,
                        ical_use_cron_job: revertCron,
                        ical_interval_fetch: revertInterval,
                      }
                    : s
                );
                alert('Failed to save. Setting reverted.');
              });
              return;
            }
            setSettings((s) => (s ? { ...s, ical_subscriptions_enabled: true } : s));
            api.admin
              .setIcalSubscriptionsEnabled(true)
              .then(() => api.admin.setIcalFetchTrigger('browser_interval'))
              .then(() => {
                setSettings((s) =>
                  s
                    ? {
                        ...s,
                        ical_subscriptions_enabled: true,
                        ical_use_cron_job: false,
                        ical_interval_fetch: true,
                      }
                    : s
                );
              })
              .catch(() => {
                setSettings((s) =>
                  s
                    ? {
                        ...s,
                        ical_subscriptions_enabled: prevSubs,
                        ical_use_cron_job: revertCron,
                        ical_interval_fetch: revertInterval,
                      }
                    : s
                );
                alert('Failed to save. Setting reverted.');
              });
          }}
        />
        Subscribed calendars enabled (fetch external iCal feeds)
      </label>

      {(() => {
        const subsOn = settings.ical_subscriptions_enabled !== false;
        const cronSelected = subsOn && settings.ical_use_cron_job === true;
        const browserSelected = subsOn && !cronSelected && settings.ical_interval_fetch !== false;
        const applyFetchMode = (mode: 'browser_interval' | 'server_cron') => {
          const prevCron = settings.ical_use_cron_job === true;
          const prevInterval = settings.ical_interval_fetch !== false;
          setSettings((s) =>
            s
              ? {
                  ...s,
                  ical_use_cron_job: mode === 'server_cron',
                  ical_interval_fetch: mode === 'browser_interval',
                }
              : s
          );
          api.admin.setIcalFetchTrigger(mode).catch(() => {
            setSettings((s) =>
              s
                ? {
                    ...s,
                    ical_use_cron_job: prevCron,
                    ical_interval_fetch: prevInterval,
                  }
                : s
            );
            alert('Failed to save. Setting reverted.');
          });
        };
        return (
          <fieldset
            disabled={!subsOn}
            style={{
              marginTop: '1rem',
              padding: '0.75rem 1rem',
              border: '1px solid var(--border)',
              borderRadius: 6,
              maxWidth: '42rem',
            }}
          >
            <legend style={{ padding: '0 0.35rem', fontWeight: 600 }}>How calendars refresh</legend>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginTop: 0, marginBottom: '0.75rem' }}>
              Choose one. Browser mode polls from signed-in clients while the Today tab is active. Cron mode turns off client-triggered downloads; the PHP cron script syncs every user instead. Selecting browser mode clears server cron job mode in application settings (remove the crontab line on the host yourself).
            </p>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.6rem', cursor: subsOn ? 'pointer' : 'default' }}>
              <input
                type="radio"
                name="admin-ical-fetch-mode"
                checked={browserSelected}
                disabled={!subsOn}
                onChange={() => applyFetchMode('browser_interval')}
                style={{ marginTop: '0.2rem' }}
              />
              <span>
                <strong>Fetch from browsers on an interval</strong>
                <span style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                  While the Today tab is open, clients request sync-if-stale on the interval below. When subscribed calendars are off, interval fetch and cron job mode are cleared.
                </span>
              </span>
            </label>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.75rem', cursor: subsOn ? 'pointer' : 'default' }}>
              <input
                type="radio"
                name="admin-ical-fetch-mode"
                checked={cronSelected}
                disabled={!subsOn}
                onChange={() => applyFetchMode('server_cron')}
                style={{ marginTop: '0.2rem' }}
              />
              <span>
                <strong>Use cron job</strong>
                <span style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                  Run{' '}
                  <code style={{ fontSize: '0.8rem', wordBreak: 'break-all' }}>php /path/to/app/cron/ical_sync_all_users.php</code>{' '}
                  on a schedule. The app uses the sync interval below as the staleness window so spacing crontab runs to match it avoids wasted passes. The script exits immediately if this mode is off or calendars are disabled.
                </span>
              </span>
            </label>
            <label style={{ display: 'block', fontSize: '0.9rem' }} htmlFor="admin-ical-sync-interval">
              Sync interval (minutes):{' '}
              <select
                id="admin-ical-sync-interval"
                value={settings.ical_sync_interval_minutes ?? 15}
                disabled={!subsOn}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setSettings((s) => (s ? { ...s, ical_sync_interval_minutes: v } : s));
                  api.admin.setIcalSyncIntervalMinutes(v).catch(alert);
                }}
                style={{ marginLeft: '0.25rem', padding: '0.3rem' }}
              >
                <option value={5}>5</option>
                <option value={15}>15</option>
                <option value={30}>30</option>
                <option value={60}>60</option>
              </select>
            </label>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0.35rem 0 0', maxWidth: '38rem' }}>
              For browser mode, this is how often each client polls. For cron mode, schedule the system task at this spacing (or finer); the server treats subscriptions as stale after this many minutes.
            </p>
          </fieldset>
        );
      })()}
    </>
  );
}

function AdminIcalViewLastFetch({
  lastFetch,
  onLoad,
  saveLastFetchOn,
  onOpenFeedModal,
  useCronJob = false,
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
    subscriptions?: Array<{
      subscription_id: number;
      feed_url: string | null;
      sync_state: string | null;
      message: string | null;
      error: string | null;
      bytes_fetched: number | null;
      parsed_count: number | null;
      range_from: string | null;
      range_to: string | null;
      updated_at: string | null;
      path: string | null;
      content: string | null;
      parsed_events: Array<{ uid: string; title: string; start: string; end: string; allDay: boolean }> | null;
      parse_range: { from: string; to: string };
    }>;
  } | null;
  onLoad: () => void;
  saveLastFetchOn: boolean;
  onOpenFeedModal: (subscriptionId: number | null) => void;
  useCronJob?: boolean;
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
  const subs = lastFetch?.subscriptions;
  const hasSavedFeed =
    saveLastFetchOn &&
    (subs?.some((s) => s.content != null && s.content !== '') || (lastFetch?.content != null && lastFetch.content !== ''));

  return (
    <>
      <h3 style={{ marginTop: 0 }}>iCal sync state (per calendar)</h3>
      <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
        Sync metadata is stored in the database for each subscription. State moves through downloading → parsing → saving → synced (or error).
        {useCronJob ? ' With Use Cron Job enabled, the server cron script refreshes feeds; browsers read cached events unless you force sync below.' : ''}
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <Button onClick={onLoad}>Load sync state</Button>
        <Button onClick={handleForceSync} disabled={forceSyncLoading}>
          {forceSyncLoading ? 'Syncing…' : 'Force sync'}
        </Button>
        {hasSavedFeed && (
          <Button
            onClick={() => {
              const first = subs?.find((s) => s.content != null && s.content !== '');
              onOpenFeedModal(first?.subscription_id ?? subs?.[0]?.subscription_id ?? null);
            }}
          >
            View feed (raw + parsed)
          </Button>
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
          {subs && subs.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {subs.map((s) => (
                <div key={s.subscription_id} style={{ padding: '0.75rem', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-elevated)' }}>
                  <h4 style={{ marginTop: 0, marginBottom: '0.35rem' }}>Subscription #{s.subscription_id}</h4>
                  <p style={{ fontSize: '0.85rem', margin: '0 0 0.5rem', wordBreak: 'break-all', color: 'var(--text-muted)' }}>{s.feed_url || '—'}</p>
                  <dl style={{ fontSize: '0.85rem', margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.2rem 0.75rem' }}>
                    {[
                      ['sync_state', s.sync_state],
                      ['updated_at', s.updated_at],
                      ['range_from', s.range_from],
                      ['range_to', s.range_to],
                      ['parsed_count', s.parsed_count],
                      ['bytes_fetched', s.bytes_fetched],
                      ['path', s.path],
                      ['message', s.message],
                      ['error', s.error],
                    ].map(([k, v]) => {
                      if (v === undefined || v === null || v === '') return null;
                      return (
                        <div key={String(k)} style={{ gridColumn: '1 / -1', display: 'contents' }}>
                          <dt style={{ margin: 0, color: 'var(--text-muted)' }}>{k}</dt>
                          <dd style={{ margin: 0, wordBreak: 'break-all' }}>{String(v)}</dd>
                        </div>
                      );
                    })}
                  </dl>
                </div>
              ))}
            </div>
          ) : lastFetch.sync_state && Object.keys(lastFetch.sync_state).length > 0 ? (
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
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>No sync state yet. Trigger a sync (open Today tab, run cron, or Force sync) then load again.</p>
          )}
          <p style={{ fontSize: '0.9rem', marginTop: '0.75rem' }}><strong>Save folder:</strong> {lastFetch.save_folder || '—'}</p>
          {!subs?.length && (
            <>
              <p style={{ fontSize: '0.9rem' }}><strong>Last saved path:</strong> {lastFetch.path || '—'}</p>
              {lastFetch.content != null && lastFetch.content !== '' && !saveLastFetchOn && (
                <pre style={{ marginTop: '0.5rem', padding: '0.75rem', background: 'var(--surface-elevated)', border: '1px solid var(--border)', borderRadius: 4, fontSize: '0.8rem', overflow: 'auto', maxHeight: '40vh', whiteSpace: 'pre-wrap' }}>
                  {lastFetch.content}
                </pre>
              )}
            </>
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
