'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTheme } from 'next-themes';
import type { AuthUser } from '@/lib/auth';
import { api } from '@/lib/api';
import { resolveAppUrl } from '@/lib/getBaseUrl';
import { SubscriptionRow } from '@/components/SubscriptionRow';
import { ColorPickerModal, randomScheduleFriendlyColor } from '@/components/ColorPickerModal';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import type { TimeSettings, IcalSubscriptionRow } from '@/lib/api';
import {
  PRIORITY_LEVELS,
  parsePriorityThemeJson,
  priorityThemeToJson,
  parsePriorityLayoutJson,
  priorityLayoutCustomToJson,
  parseBucketLabelsJson,
  bucketLabelsToJson,
  type PriorityThemeMap,
} from '@/lib/priorityTheme';
import { bucketLayoutCustomToJson, parseBucketLayoutJson, type BucketDef } from '@/lib/taskBuckets';
import {
  type ContactEmailHandler,
  type ContactPhoneHandler,
  type ContactLinkPrefs,
  contactLinkPrefsToJson,
  parseContactLinkPrefsJson,
  GMAIL_ACCOUNT_INDEX_MAX,
  gmailAccountOptionLabel,
} from '@/lib/contactLinks';
import { WeatherSettingsSection } from '@/components/WeatherSettingsSection';
import { BulkImportSettingsSection } from '@/components/BulkImportSettingsSection';

type PriorityRow = { id: string; label: string; icon: string; color?: string };
import { DT } from '@/lib/uiIdentifiers';
import { OrgLucideIcon } from '@/components/OrgLucideIcon';
import { OrgIconPickerSelect } from '@/components/OrgIconPickerSelect';

type SectionId = 'profile' | 'subscriptions' | 'schedule' | 'weather' | 'organization' | 'bulk-import';

type Props = {
  user: AuthUser;
  onClose: () => void;
  onLogout?: () => void;
  onUserUpdated: () => void;
  /** Called when categories/subcategories/tags are added/updated/deleted so the main task view can refresh its org lists */
  onOrganizationChange?: () => void;
};

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'profile', label: 'Profile' },
  { id: 'subscriptions', label: 'Subscriptions' },
  { id: 'schedule', label: 'Schedule Settings' },
  { id: 'weather', label: 'Weather' },
  { id: 'organization', label: 'Organization' },
  { id: 'bulk-import', label: 'Bulk import' },
];

export function UserSettingsView({ user, onClose, onUserUpdated, onOrganizationChange }: Props) {
  const { setTheme } = useTheme();
  const [section, setSection] = useState<SectionId>('profile');
  const [newPassword, setNewPassword] = useState('');
  const [feedUrl, setFeedUrl] = useState('');
  const [subscriptions, setSubscriptions] = useState<IcalSubscriptionRow[]>([]);
  const [addUrl, setAddUrl] = useState('');
  const [settings, setSettings] = useState<TimeSettings | null>(null);
  const [organizationCategories, setOrganizationCategories] = useState<Array<{ id: number; name: string; color?: string | null; icon?: string | null }>>([]);
  const [organizationSubcategories, setOrganizationSubcategories] = useState<Array<{ id: number; category_id: number; name: string }>>([]);
  const [organizationTags, setOrganizationTags] = useState<Array<{ id: number; name: string; color?: string | null }>>([]);
  const [organizationBlocks, setOrganizationBlocks] = useState<Array<{ id: number; name: string; color?: string | null; icon?: string | null }>>([]);
  const [excludedIcalOpen, setExcludedIcalOpen] = useState(false);
  const [excludedIcalList, setExcludedIcalList] = useState<Array<{ uid: string; title: string }>>([]);
  const [priorityEdit, setPriorityEdit] = useState<PriorityThemeMap | null>(null);
  const [priorityCustomRows, setPriorityCustomRows] = useState<PriorityRow[]>([]);
  const [bucketCustomRows, setBucketCustomRows] = useState<BucketDef[]>([]);
  const [priorityColorPick, setPriorityColorPick] = useState<null | { kind: 'default'; id: string } | { kind: 'custom'; index: number }>(
    null
  );
  const [bucketUnLabel, setBucketUnLabel] = useState('');
  const [bucketPendingLabel, setBucketPendingLabel] = useState('');
  const [autoPriMode, setAutoPriMode] = useState<'days' | 'due_date'>('days');
  const [autoPriDays, setAutoPriDays] = useState(1);
  const [contactLinkPrefs, setContactLinkPrefs] = useState<ContactLinkPrefs>(
    parseContactLinkPrefsJson(null)
  );

  useEffect(() => {
    api.icalFeed.getUrl().then(({ token }) => {
      setFeedUrl(resolveAppUrl(`api/ical.php?token=${encodeURIComponent(token)}`));
    }).catch(() => setFeedUrl(''));
    api.icalSubscriptions.list().then(({ subscriptions: subs }) => setSubscriptions(subs)).catch(() => {});
  }, []);

  const loadSettings = useCallback(() => {
    api.settings.get().then(setSettings).catch(() => setSettings(null));
  }, []);

  useEffect(() => {
    if (!settings) return;
    setAutoPriMode(settings.auto_priority_default_mode === 'due_date' ? 'due_date' : 'days');
    const d = Number(settings.auto_priority_default_days_per_step);
    setAutoPriDays(Number.isFinite(d) && d >= 1 && d <= 365 ? Math.floor(d) : 1);
  }, [settings]);
  const loadOrganization = useCallback(() => {
    api.organization.list().then((r) => {
      setOrganizationCategories(r.categories ?? []);
      setOrganizationSubcategories(r.subcategories ?? []);
      setOrganizationTags(r.tags ?? []);
      setOrganizationBlocks(r.blocks ?? []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (section === 'schedule' || section === 'weather' || section === 'profile' || section === 'bulk-import') loadSettings();
  }, [section, loadSettings]);

  useEffect(() => {
    if (!settings) return;
    setPriorityEdit(parsePriorityThemeJson(settings.priority_theme_json ?? null));
    const bl = parseBucketLabelsJson(settings.bucket_labels_json ?? null);
    setBucketUnLabel(bl.unassigned);
    setBucketPendingLabel(bl.pending);
    const pl = parsePriorityLayoutJson(settings.priority_layout_json ?? null);
    if (pl) setPriorityCustomRows(pl.priorities);
    else {
      const th = parsePriorityThemeJson(settings.priority_theme_json ?? null);
      setPriorityCustomRows(PRIORITY_LEVELS.map((id) => ({ id, ...th[id] })));
    }
    const blay = parseBucketLayoutJson(settings.bucket_layout_json ?? null);
    if (blay) setBucketCustomRows(blay.buckets);
    else setBucketCustomRows([
      { id: 'unassigned', label: bl.unassigned },
      { id: 'pending', label: bl.pending },
    ]);
    setContactLinkPrefs(parseContactLinkPrefsJson(settings.contact_link_json ?? null));
  }, [settings]);
  useEffect(() => {
    if (section === 'organization') loadOrganization();
  }, [section, loadOrganization]);

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
    <div className={`settings-inner ${DT.userSettingsInner}`}>
      <div className="settings-view-header">
        <h2>User settings</h2>
        <button type="button" className="settings-close" aria-label="Close" title="Close" onClick={onClose}>×</button>
      </div>
      <nav className="user-settings-nav" aria-label="Settings sections" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={'settings-nav-btn' + (section === s.id ? ' active' : '')}
            onClick={() => setSection(s.id)}
            style={{
              padding: '0.35rem 0.75rem',
              borderRadius: '0.35rem',
              border: '1px solid var(--border)',
              background: section === s.id ? 'var(--accent)' : 'transparent',
              color: section === s.id ? '#fff' : 'var(--text)',
              cursor: 'pointer',
            }}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {section === 'profile' && (
        <div className="user-settings-section">
          <h3 style={{ marginTop: 0 }}>Profile</h3>
          <p>Username: {user.username}</p>
          <h4 style={{ marginTop: '1rem' }}>Appearance</h4>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginTop: 0 }}>
            Choose a dark interface or a lighter day mode. This applies on this device after you sign in.
          </p>
          {settings ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.5rem' }} role="group" aria-label="Color theme">
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="ui-theme"
                  checked={(settings.ui_theme ?? 'dark') === 'dark'}
                  onChange={() => {
                    api.settings
                      .update({ ui_theme: 'dark' })
                      .then(() => {
                        setTheme('dark');
                        loadSettings();
                      })
                      .catch(alert);
                  }}
                />
                Dark
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="ui-theme"
                  checked={(settings.ui_theme ?? 'dark') === 'light'}
                  onChange={() => {
                    api.settings
                      .update({ ui_theme: 'light' })
                      .then(() => {
                        setTheme('light');
                        loadSettings();
                      })
                      .catch(alert);
                  }}
                />
                Day (light)
              </label>
            </div>
          ) : (
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Loading appearance…</p>
          )}
          {user.sso.length > 0 && (
            <>
              <h4 style={{ marginTop: '1rem' }}>Linked accounts</h4>
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
          <h4 style={{ marginTop: '1rem' }}>Change password</h4>
          {user.username === 'demo' ? (
            <p style={{ color: 'var(--text-muted)' }}>Password: ***** (demo account cannot be changed)</p>
          ) : (
            <form onSubmit={handleChangePassword}>
              <label>New password <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={6} /></label>
              <button type="submit">Update password</button>
            </form>
          )}
        </div>
      )}

      {section === 'subscriptions' && (
        <div className="user-settings-section">
          <h3 style={{ marginTop: 0 }}>Subscriptions</h3>
          <h4 style={{ marginTop: '1rem' }}>Calendar feed</h4>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Share this URL with other apps to show your scheduled tasks.</p>
          <div style={{ marginBottom: '0.5rem' }}>
            <input type="text" readOnly value={feedUrl} style={{ width: '100%', maxWidth: '32rem', marginRight: '0.5rem', padding: '0.35rem' }} />
            <button type="button" onClick={() => navigator.clipboard.writeText(feedUrl).then(() => alert('Copied')).catch(() => alert('Could not copy'))}>Copy</button>
          </div>
          <h4 style={{ marginTop: '1.5rem' }}>Subscribed calendars</h4>
          <div style={{ marginBottom: '0.5rem' }}>
            <input type="url" placeholder="https://… iCal feed URL" value={addUrl} onChange={(e) => setAddUrl(e.target.value)} style={{ width: '100%', maxWidth: '32rem', marginRight: '0.5rem', padding: '0.35rem' }} />
            <button type="button" onClick={handleAddSubscription}>Add</button>
          </div>
          <div className="subscriptions-scroll-list" style={{ marginTop: '0.5rem' }}>
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
          <h4 style={{ marginTop: '1.5rem' }}>Excluded iCal events</h4>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Events hidden from the schedule. Add them back to show again.</p>
          <button type="button" onClick={() => { setExcludedIcalOpen(true); api.icalExcluded.list().then((r) => setExcludedIcalList(r.excluded ?? [])).catch(() => setExcludedIcalList([])); }}>
            Manage excluded
          </button>
          <Modal
            open={excludedIcalOpen}
            onClose={() => setExcludedIcalOpen(false)}
            title="Excluded iCal events"
            actions={<Button onClick={() => setExcludedIcalOpen(false)}>Close</Button>}
          >
            <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
              {excludedIcalList.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>No excluded events.</p>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {excludedIcalList.map((item) => (
                    <li key={item.uid} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', padding: '0.35rem 0', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ flex: 1, minWidth: 0 }} title={item.uid}>{item.title || item.uid}</span>
                      <Button
                        onClick={() => {
                          api.icalExcluded.remove(item.uid).then(() => {
                            setExcludedIcalList((prev) => prev.filter((x) => x.uid !== item.uid));
                          }).catch(alert);
                        }}
                      >
                        Add back
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Modal>
        </div>
      )}

      {section === 'schedule' && (
        <div className="user-settings-section">
          <h3 style={{ marginTop: 0 }}>Schedule Settings</h3>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Increment, layout, and time zone for the schedule view.</p>
          {settings == null ? (
            <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
          ) : (
            <>
              <fieldset style={{ border: 'none', padding: 0, margin: '1rem 0 0' }}>
                <legend style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.35rem' }}>Task list &amp; schedule layout</legend>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 0.5rem' }}>
                  Desktop: place tasks above the schedule (default), or tasks in a narrow column to the left with the schedule on the right. Mobile always stacks tasks above the schedule.
                </p>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', marginBottom: '0.35rem' }}>
                  <input
                    type="radio"
                    name="task-schedule-layout"
                    checked={(settings.task_schedule_layout ?? 'stacked') === 'stacked'}
                    onChange={() => {
                      setSettings((s) => (s ? { ...s, task_schedule_layout: 'stacked' } : s));
                      api.settings.update({ task_schedule_layout: 'stacked' }).then(loadSettings).catch(alert);
                    }}
                  />
                  Stacked — tasks above schedule
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="task-schedule-layout"
                    checked={(settings.task_schedule_layout ?? 'stacked') === 'split'}
                    onChange={() => {
                      setSettings((s) => (s ? { ...s, task_schedule_layout: 'split' } : s));
                      api.settings.update({ task_schedule_layout: 'split' }).then(loadSettings).catch(alert);
                    }}
                  />
                  Side by side — tasks (narrow) left, schedule right
                </label>
              </fieldset>
              <label style={{ display: 'block', marginTop: '1rem' }}>
                Increment
                <span style={{ marginLeft: '0.5rem' }}>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={settings.increment_value}
                    onChange={(e) => {
                      const v = Math.max(1, Math.min(60, parseInt(e.target.value, 10) || 15));
                      setSettings((s) => (s ? { ...s, increment_value: v } : s));
                    }}
                    onBlur={(e) => {
                      const v = Math.max(1, Math.min(60, parseInt(e.target.value, 10) || 15));
                      api.settings.update({ increment_value: v }).then(loadSettings).catch(alert);
                    }}
                    style={{ width: '3rem', marginLeft: '0.35rem', padding: '0.35rem' }}
                  />
                  <select
                    value={settings.increment_unit}
                    onChange={(e) => {
                      const v = e.target.value as 'min' | 'hr';
                      setSettings((s) => (s ? { ...s, increment_unit: v } : s));
                      api.settings.update({ increment_unit: v }).then(loadSettings).catch(alert);
                    }}
                    style={{ marginLeft: '0.25rem', padding: '0.35rem' }}
                  >
                    <option value="min">min</option>
                    <option value="hr">hr</option>
                  </select>
                </span>
              </label>
              <label style={{ display: 'block', marginTop: '1rem' }}>
                Time zone (IANA, e.g. America/Los_Angeles; empty = browser)
                <input
                  type="text"
                  list="user-settings-timezone-suggestions"
                  value={settings.timezone ?? ''}
                  onChange={(e) => setSettings((s) => (s ? { ...s, timezone: e.target.value } : s))}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    api.settings.update({ timezone: v }).then(loadSettings).catch(alert);
                  }}
                  placeholder="Browser"
                  style={{ display: 'block', width: '100%', maxWidth: '20rem', marginTop: '0.25rem', padding: '0.35rem' }}
                />
                <datalist id="user-settings-timezone-suggestions">
                  {['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Tokyo', 'Australia/Sydney', 'UTC'].map((tz) => (
                    <option key={tz} value={tz} />
                  ))}
                </datalist>
              </label>
              <fieldset style={{ border: 'none', padding: 0, margin: '1.75rem 0 0' }}>
                <legend style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.35rem' }}>Schedule display</legend>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 0.5rem' }}>
                  Control category, subcategory, and tag lines on timed schedule blocks (Today, Week, and Calendar day views).
                </p>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', marginBottom: '0.35rem' }}>
                  <input
                    type="checkbox"
                    checked={!!settings.schedule_hide_category_subcategory}
                    onChange={(e) => {
                      const v = e.target.checked;
                      setSettings((s) => (s ? { ...s, schedule_hide_category_subcategory: v } : s));
                      api.settings.update({ schedule_hide_category_subcategory: v }).then(loadSettings).catch(alert);
                    }}
                  />
                  Hide category and subcategory on schedule blocks
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={!!settings.schedule_hide_tags}
                    onChange={(e) => {
                      const v = e.target.checked;
                      setSettings((s) => (s ? { ...s, schedule_hide_tags: v } : s));
                      api.settings.update({ schedule_hide_tags: v }).then(loadSettings).catch(alert);
                    }}
                  />
                  Hide tags on schedule blocks
                </label>
              </fieldset>
              <fieldset style={{ border: 'none', padding: 0, margin: '1.75rem 0 0' }}>
                <legend style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.35rem' }}>Contact links</legend>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 0.5rem' }}>
                  Task links using <code>mailto:</code>, <code>tel:</code>, or <code>sms:</code> (or a bare email / phone when added) show a contact icon. Choose what opens when you click them.
                </p>
                <label style={{ display: 'block', marginBottom: '0.65rem', maxWidth: '22rem' }}>
                  Email contacts open in
                  <select
                    value={contactLinkPrefs.emailHandler}
                    onChange={(e) => {
                      const emailHandler = e.target.value as ContactEmailHandler;
                      const next = { ...contactLinkPrefs, emailHandler };
                      setContactLinkPrefs(next);
                      api.settings
                        .update({ contact_link_json: contactLinkPrefsToJson(next) })
                        .then(loadSettings)
                        .catch(alert);
                    }}
                    style={{ display: 'block', width: '100%', marginTop: '0.25rem', padding: '0.35rem' }}
                  >
                    <option value="mailto">Default mail app (mailto)</option>
                    <option value="gmail">Gmail (web compose)</option>
                    <option value="outlook_web">Outlook (web compose)</option>
                    <option value="yahoo_web">Yahoo Mail (web compose)</option>
                  </select>
                </label>
                {contactLinkPrefs.emailHandler === 'gmail' && (
                  <label style={{ display: 'block', marginBottom: '0.65rem', maxWidth: '22rem' }}>
                    Gmail account slot
                    <select
                      value={contactLinkPrefs.gmailAccountIndex}
                      onChange={(e) => {
                        const next = { ...contactLinkPrefs, gmailAccountIndex: Number(e.target.value) };
                        setContactLinkPrefs(next);
                        api.settings
                          .update({ contact_link_json: contactLinkPrefsToJson(next) })
                          .then(loadSettings)
                          .catch(alert);
                      }}
                      style={{ display: 'block', width: '100%', marginTop: '0.25rem', padding: '0.35rem' }}
                    >
                      {Array.from({ length: GMAIL_ACCOUNT_INDEX_MAX + 1 }, (_, i) => (
                        <option key={i} value={i}>
                          {gmailAccountOptionLabel(i)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label style={{ display: 'block', marginBottom: '0.35rem', maxWidth: '22rem' }}>
                  Phone contacts open with
                  <select
                    value={contactLinkPrefs.phoneHandler}
                    onChange={(e) => {
                      const phoneHandler = e.target.value as ContactPhoneHandler;
                      const next = { ...contactLinkPrefs, phoneHandler };
                      setContactLinkPrefs(next);
                      api.settings
                        .update({ contact_link_json: contactLinkPrefsToJson(next) })
                        .then(loadSettings)
                        .catch(alert);
                    }}
                    style={{ display: 'block', width: '100%', marginTop: '0.25rem', padding: '0.35rem' }}
                  >
                    <option value="tel">Phone / FaceTime (tel)</option>
                    <option value="sms">Messages (sms)</option>
                  </select>
                </label>
              </fieldset>
              <fieldset style={{ border: 'none', padding: 0, margin: '1.75rem 0 0' }}>
                <legend style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.35rem' }}>Task list buckets</legend>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 0.5rem' }}>
                  Default: two lists (same behavior as before). Custom: any number of buckets (2–16), each with a stable id and label. Favorites are separate.
                </p>
                {parseBucketLayoutJson(settings.bucket_layout_json ?? null) ? (
                  <>
                    {bucketCustomRows.map((row, idx) => (
                      <div
                        key={`${row.id}-${idx}`}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '7rem 1fr 1fr',
                          gap: '0.35rem',
                          alignItems: 'center',
                          marginBottom: '0.35rem',
                          maxWidth: '32rem',
                        }}
                      >
                        <input
                          type="text"
                          value={row.id}
                          onChange={(e) =>
                            setBucketCustomRows((prev) =>
                              prev.map((r, i) => (i === idx ? { ...r, id: e.target.value.trim().slice(0, 32) } : r))
                            )
                          }
                          aria-label="Bucket id"
                          placeholder="id (a-z, 0-9, _-)"
                          style={{ padding: '0.35rem' }}
                        />
                        <input
                          type="text"
                          value={row.label}
                          onChange={(e) =>
                            setBucketCustomRows((prev) =>
                              prev.map((r, i) => (i === idx ? { ...r, label: e.target.value } : r))
                            )
                          }
                          aria-label="Bucket label"
                          style={{ padding: '0.35rem' }}
                        />
                        <button
                          type="button"
                          disabled={bucketCustomRows.length <= 2}
                          onClick={() => setBucketCustomRows((prev) => prev.filter((_, i) => i !== idx))}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem' }}>
                      <button
                        type="button"
                        onClick={() =>
                          setBucketCustomRows((prev) => [...prev, { id: `bucket_${Date.now()}`, label: 'New list' }])
                        }
                      >
                        Add bucket
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          api.settings
                            .update({ bucket_layout_json: bucketLayoutCustomToJson(bucketCustomRows) })
                            .then(loadSettings)
                            .catch(alert);
                        }}
                      >
                        Save custom buckets
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          api.settings
                            .update({ bucket_layout_json: '', bucket_labels_json: '' })
                            .then(loadSettings)
                            .catch(alert);
                        }}
                      >
                        Use default two buckets
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <label style={{ display: 'block', marginBottom: '0.35rem' }}>
                      First list title
                      <input
                        type="text"
                        value={bucketUnLabel}
                        onChange={(e) => setBucketUnLabel(e.target.value)}
                        style={{ display: 'block', width: '100%', maxWidth: '20rem', marginTop: '0.25rem', padding: '0.35rem' }}
                      />
                    </label>
                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>
                      Second list title
                      <input
                        type="text"
                        value={bucketPendingLabel}
                        onChange={(e) => setBucketPendingLabel(e.target.value)}
                        style={{ display: 'block', width: '100%', maxWidth: '20rem', marginTop: '0.25rem', padding: '0.35rem' }}
                      />
                    </label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <button
                        type="button"
                        onClick={() => {
                          api.settings
                            .update({
                              bucket_labels_json: bucketLabelsToJson({
                                unassigned: bucketUnLabel.trim() || 'Unassigned',
                                pending: bucketPendingLabel.trim() || 'Pending',
                              }),
                            })
                            .then(loadSettings)
                            .catch(alert);
                        }}
                      >
                        Save bucket names
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          api.settings
                            .update({ bucket_labels_json: '' })
                            .then(loadSettings)
                            .catch(alert);
                        }}
                      >
                        Reset bucket names
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setBucketCustomRows([
                            { id: 'unassigned', label: bucketUnLabel.trim() || 'Unassigned' },
                            { id: 'pending', label: bucketPendingLabel.trim() || 'Pending' },
                          ]);
                          api.settings
                            .update({
                              bucket_layout_json: bucketLayoutCustomToJson([
                                { id: 'unassigned', label: bucketUnLabel.trim() || 'Unassigned' },
                                { id: 'pending', label: bucketPendingLabel.trim() || 'Pending' },
                              ]),
                            })
                            .then(loadSettings)
                            .catch(alert);
                        }}
                      >
                        Switch to custom buckets
                      </button>
                    </div>
                  </>
                )}
              </fieldset>

              <fieldset style={{ border: 'none', padding: 0, margin: '1.75rem 0 0' }}>
                <legend style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.35rem' }}>Priorities</legend>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 0.5rem' }}>
                  Default: four built-in levels (task values stay commitment / high / medium / low). Custom: your own ordered
                  priority ids (2–24). Colors use the picker.
                </p>
                {parsePriorityLayoutJson(settings.priority_layout_json ?? null) ? (
                  <>
                    {priorityCustomRows.map((row, idx) => (
                      <div
                        key={`${row.id}-${idx}`}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '6.5rem 1fr 2.5rem 2.25rem 4.5rem',
                          gap: '0.35rem',
                          alignItems: 'center',
                          marginBottom: '0.35rem',
                          maxWidth: '34rem',
                        }}
                      >
                        <input
                          type="text"
                          value={row.id}
                          onChange={(e) =>
                            setPriorityCustomRows((prev) =>
                              prev.map((r, i) => (i === idx ? { ...r, id: e.target.value.trim().slice(0, 32) } : r))
                            )
                          }
                          aria-label="Priority id"
                          style={{ padding: '0.35rem' }}
                        />
                        <input
                          type="text"
                          value={row.label}
                          onChange={(e) =>
                            setPriorityCustomRows((prev) =>
                              prev.map((r, i) => (i === idx ? { ...r, label: e.target.value } : r))
                            )
                          }
                          aria-label="Label"
                          style={{ padding: '0.35rem' }}
                        />
                        <input
                          type="text"
                          value={row.icon}
                          onChange={(e) =>
                            setPriorityCustomRows((prev) =>
                              prev.map((r, i) => (i === idx ? { ...r, icon: e.target.value } : r))
                            )
                          }
                          maxLength={16}
                          aria-label="Icon"
                          style={{ padding: '0.35rem' }}
                        />
                        <button
                          type="button"
                          title="Pick color"
                          onClick={() => setPriorityColorPick({ kind: 'custom', index: idx })}
                          style={{
                            width: '2.25rem',
                            height: '2.25rem',
                            borderRadius: '4px',
                            border: '1px solid var(--border)',
                            background: row.color || 'var(--surface)',
                          }}
                        />
                        <button
                          type="button"
                          disabled={priorityCustomRows.length <= 2}
                          onClick={() => setPriorityCustomRows((prev) => prev.filter((_, i) => i !== idx))}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem' }}>
                      <button
                        type="button"
                        onClick={() =>
                          setPriorityCustomRows((prev) => [
                            ...prev,
                            { id: `p_${Date.now()}`, label: 'New', icon: '●', color: randomScheduleFriendlyColor() },
                          ])
                        }
                      >
                        Add priority
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          api.settings
                            .update({ priority_layout_json: priorityLayoutCustomToJson(priorityCustomRows) })
                            .then(loadSettings)
                            .catch(alert);
                        }}
                      >
                        Save custom priorities
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          api.settings
                            .update({ priority_layout_json: '', priority_theme_json: '' })
                            .then(loadSettings)
                            .catch(alert);
                        }}
                      >
                        Use built-in default priorities
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    {priorityEdit &&
                      PRIORITY_LEVELS.map((key) => (
                        <div
                          key={key}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '5.5rem 1fr 2.75rem 2.25rem',
                            gap: '0.35rem',
                            alignItems: 'center',
                            marginBottom: '0.35rem',
                            maxWidth: '28rem',
                          }}
                        >
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'capitalize' }}>{key}</span>
                          <input
                            type="text"
                            value={priorityEdit[key].label}
                            onChange={(e) =>
                              setPriorityEdit((prev) => {
                                const base = prev ?? parsePriorityThemeJson(settings.priority_theme_json ?? null);
                                return { ...base, [key]: { ...base[key], label: e.target.value } };
                              })
                            }
                            aria-label={`${key} label`}
                            style={{ padding: '0.35rem' }}
                          />
                          <input
                            type="text"
                            value={priorityEdit[key].icon}
                            onChange={(e) =>
                              setPriorityEdit((prev) => {
                                const base = prev ?? parsePriorityThemeJson(settings.priority_theme_json ?? null);
                                return { ...base, [key]: { ...base[key], icon: e.target.value } };
                              })
                            }
                            maxLength={16}
                            aria-label={`${key} icon`}
                            style={{ padding: '0.35rem', width: '100%' }}
                          />
                          <button
                            type="button"
                            title="Pick color"
                            onClick={() => setPriorityColorPick({ kind: 'default', id: key })}
                            style={{
                              width: '2.25rem',
                              height: '2.25rem',
                              borderRadius: '4px',
                              border: '1px solid var(--border)',
                              background: priorityEdit[key].color || 'var(--surface)',
                            }}
                          />
                        </div>
                      ))}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem' }}>
                      <button
                        type="button"
                        disabled={!priorityEdit}
                        onClick={() => {
                          if (!priorityEdit) return;
                          api.settings
                            .update({ priority_theme_json: priorityThemeToJson(priorityEdit) })
                            .then(loadSettings)
                            .catch(alert);
                        }}
                      >
                        Save priorities
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          api.settings
                            .update({ priority_theme_json: '' })
                            .then(loadSettings)
                            .catch(alert);
                        }}
                      >
                        Reset priority labels
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const th = priorityEdit ?? parsePriorityThemeJson(settings.priority_theme_json ?? null);
                          const rows = PRIORITY_LEVELS.map((id) => ({ id, label: th[id].label, icon: th[id].icon, color: th[id].color }));
                          setPriorityCustomRows(rows);
                          api.settings
                            .update({ priority_layout_json: priorityLayoutCustomToJson(rows) })
                            .then(loadSettings)
                            .catch(alert);
                        }}
                      >
                        Switch to custom priorities
                      </button>
                    </div>
                  </>
                )}
              </fieldset>
              <ColorPickerModal
                open={priorityColorPick != null}
                onClose={() => setPriorityColorPick(null)}
                value={
                  priorityColorPick?.kind === 'default' && priorityEdit
                    ? priorityEdit[priorityColorPick.id as keyof PriorityThemeMap].color ?? '#708090'
                    : priorityColorPick?.kind === 'custom'
                      ? priorityCustomRows[priorityColorPick.index]?.color ?? '#708090'
                      : '#708090'
                }
                onSelect={(hex) => {
                  if (priorityColorPick?.kind === 'default' && priorityEdit) {
                    const id = priorityColorPick.id as keyof PriorityThemeMap;
                    setPriorityEdit({ ...priorityEdit, [id]: { ...priorityEdit[id], color: hex } });
                  } else if (priorityColorPick?.kind === 'custom') {
                    setPriorityCustomRows((rows) =>
                      rows.map((r, i) => (i === priorityColorPick.index ? { ...r, color: hex } : r))
                    );
                  }
                  setPriorityColorPick(null);
                }}
              />

              <fieldset style={{ border: 'none', padding: 0, margin: '1.75rem 0 0' }}>
                <legend style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.35rem' }}>Auto-priority</legend>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 0.75rem' }}>
                  <strong>Schedule-wide defaults</strong> (below) apply to every task that has auto-prioritize turned on in <strong>Task details</strong>. Set an optional due date there when using the due-date mode. Priority updates run when the day rolls over.
                </p>
                <div role="radiogroup" aria-label="Default auto-priority timing" style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '0.5rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input type="radio" name="globalAutoPri" checked={autoPriMode === 'days'} onChange={() => setAutoPriMode('days')} />
                    By day — rise one priority level every N day(s)
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input type="radio" name="globalAutoPri" checked={autoPriMode === 'due_date'} onChange={() => setAutoPriMode('due_date')} />
                    By due date — map from lowest to highest between creation and due date
                  </label>
                </div>
                {autoPriMode === 'days' && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                    Days per step
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={autoPriDays}
                      onChange={(e) => setAutoPriDays(Math.min(365, Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1)))}
                      style={{ width: '4rem', padding: '0.3rem' }}
                    />
                  </label>
                )}
                <button
                  type="button"
                  disabled={!settings}
                  onClick={() => {
                    api.settings
                      .update({
                        auto_priority_default_mode: autoPriMode,
                        auto_priority_default_days_per_step: autoPriDays,
                      })
                      .then(loadSettings)
                      .catch(alert);
                  }}
                >
                  Save auto-priority defaults
                </button>
              </fieldset>
            </>
          )}
        </div>
      )}

      {section === 'weather' && settings != null && (
        <WeatherSettingsSection settings={settings} onSettingsChange={setSettings} loadSettings={loadSettings} />
      )}
      {section === 'weather' && settings == null && (
        <div className="user-settings-section">
          <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
        </div>
      )}

      {section === 'bulk-import' && (
        <BulkImportSettingsSection settings={settings} onSettingsChange={setSettings} />
      )}

      {section === 'organization' && (
        <div className="user-settings-section">
          <h3 style={{ marginTop: 0 }}>Organization</h3>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Categories, subcategories, and tags for tasks. Set colors for categories and tags.</p>
          <OrganizationCrud
            categories={organizationCategories}
            subcategories={organizationSubcategories}
            tags={organizationTags}
            blocks={organizationBlocks}
            onRefresh={loadOrganization}
            onOrganizationChange={onOrganizationChange}
          />
        </div>
      )}
    </div>
  );
}

function OrganizationCrud({
  categories,
  subcategories,
  tags,
  blocks,
  onRefresh,
  onOrganizationChange,
}: {
  categories: Array<{ id: number; name: string; color?: string | null; icon?: string | null }>;
  subcategories: Array<{ id: number; category_id: number; name: string }>;
  tags: Array<{ id: number; name: string; color?: string | null }>;
  blocks: Array<{ id: number; name: string; color?: string | null; icon?: string | null }>;
  onRefresh: () => void;
  onOrganizationChange?: () => void;
}) {
  const [newCatName, setNewCatName] = useState('');
  const [newCatColor, setNewCatColor] = useState('');
  const [newCatIcon, setNewCatIcon] = useState('');
  const [newSubcatCategoryId, setNewSubcatCategoryId] = useState<number | ''>('');
  const [newSubcatName, setNewSubcatName] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('');
  const [newBlockName, setNewBlockName] = useState('');
  const [newBlockColor, setNewBlockColor] = useState('');
  const [newBlockIcon, setNewBlockIcon] = useState('');
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [editCatIcon, setEditCatIcon] = useState('');
  const [editingSubcategoryId, setEditingSubcategoryId] = useState<number | null>(null);
  const [editingTagId, setEditingTagId] = useState<number | null>(null);
  const [editingBlockId, setEditingBlockId] = useState<number | null>(null);
  const [editBlockIcon, setEditBlockIcon] = useState('');
  const [colorPickerFor, setColorPickerFor] = useState<null | 'newCat' | 'newTag' | 'newBlock' | { editCat: number } | { editTag: number } | { editBlock: number }>(null);

  const addCategory = () => {
    const name = newCatName.trim();
    if (!name) return;
    const color = newCatColor.trim() || randomScheduleFriendlyColor();
    api.organization
      .createCategory({ name, color, icon: newCatIcon.trim() || null })
      .then(() => {
        setNewCatName('');
        setNewCatColor('');
        setNewCatIcon('');
        onRefresh();
        onOrganizationChange?.();
      })
      .catch(alert);
  };
  const addSubcategory = () => {
    const name = newSubcatName.trim();
    const cid = typeof newSubcatCategoryId === 'number' ? newSubcatCategoryId : 0;
    if (!name || cid < 1) return;
    api.organization.createSubcategory({ category_id: cid, name }).then(() => { setNewSubcatName(''); setNewSubcatCategoryId(''); onRefresh(); onOrganizationChange?.(); }).catch(alert);
  };
  const addTag = () => {
    const name = newTagName.trim();
    if (!name) return;
    const color = newTagColor.trim() || randomScheduleFriendlyColor();
    api.organization.createTag({ name, color }).then(() => { setNewTagName(''); setNewTagColor(''); onRefresh(); onOrganizationChange?.(); }).catch(alert);
  };
  const addBlock = () => {
    const name = newBlockName.trim();
    if (!name) return;
    const color = newBlockColor.trim() || randomScheduleFriendlyColor();
    api.organization
      .createBlock({ name, color, icon: newBlockIcon.trim() || null })
      .then(() => {
        setNewBlockName('');
        setNewBlockColor('');
        setNewBlockIcon('');
        onRefresh();
        onOrganizationChange?.();
      })
      .catch(alert);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginTop: '1rem' }}>
      <div>
        <h4>Categories</h4>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
          <input type="text" placeholder="New category" value={newCatName} onChange={(e) => setNewCatName(e.target.value)} style={{ padding: '0.35rem', width: '10rem' }} />
          <input type="text" placeholder="Color" value={newCatColor} onChange={(e) => setNewCatColor(e.target.value)} style={{ padding: '0.35rem', width: '8rem' }} />
          <button type="button" onClick={() => setColorPickerFor('newCat')}>Pick color</button>
          <OrgIconPickerSelect value={newCatIcon} onChange={setNewCatIcon} />
          <button type="button" onClick={addCategory} disabled={!newCatName.trim()}>Add</button>
        </div>
        <ColorPickerModal
          open={colorPickerFor === 'newCat'}
          onClose={() => setColorPickerFor(null)}
          value={newCatColor}
          onSelect={(c) => setNewCatColor(c)}
        />
        <ul style={{ listStyle: 'none', padding: 0, marginTop: '0.5rem' }}>
          {categories.map((c) => (
            <li key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
              {editingCategoryId === c.id ? (
                <>
                  <input type="text" defaultValue={c.name} id={`edit-cat-${c.id}`} style={{ padding: '0.25rem', width: '10rem' }} />
                  <input type="text" defaultValue={c.color ?? ''} placeholder="Color" style={{ padding: '0.25rem', width: '8rem' }} id={`edit-cat-color-${c.id}`} />
                  <button type="button" onClick={() => setColorPickerFor({ editCat: c.id })}>Pick</button>
                  <OrgIconPickerSelect id={`edit-cat-icon-${c.id}`} value={editCatIcon} onChange={setEditCatIcon} />
                  <button type="button" onClick={() => {
                    const name = (document.getElementById(`edit-cat-${c.id}`) as HTMLInputElement)?.value?.trim();
                    const color = (document.getElementById(`edit-cat-color-${c.id}`) as HTMLInputElement)?.value?.trim() || null;
                    const icon = editCatIcon.trim() || null;
                    if (name) api.organization.updateCategory(c.id, { name, color, icon }).then(() => { setEditingCategoryId(null); onRefresh(); onOrganizationChange?.(); }).catch(alert);
                  }}>Save</button>
                  <button type="button" onClick={() => setEditingCategoryId(null)}>Cancel</button>
                </>
              ) : (
                <>
                  <span style={{ backgroundColor: c.color ?? 'var(--surface)', padding: '0.15rem 0.5rem', borderRadius: 4, minWidth: '8rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                    <OrgLucideIcon name={c.icon} size={14} />
                    {c.name}
                  </span>
                  <button type="button" onClick={() => { setEditingCategoryId(c.id); setEditCatIcon(c.icon ?? ''); }}>Edit</button>
                  <button type="button" onClick={() => { if (confirm('Delete this category?')) api.organization.deleteCategory(c.id).then(() => { onRefresh(); onOrganizationChange?.(); }).catch(alert); }}>Delete</button>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h4>Subcategories</h4>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
          <select value={newSubcatCategoryId} onChange={(e) => setNewSubcatCategoryId(e.target.value === '' ? '' : Number(e.target.value))} style={{ padding: '0.35rem' }}>
            <option value="">Category</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input type="text" placeholder="New subcategory" value={newSubcatName} onChange={(e) => setNewSubcatName(e.target.value)} style={{ padding: '0.35rem', width: '10rem' }} />
          <button type="button" onClick={addSubcategory} disabled={!newSubcatName.trim() || typeof newSubcatCategoryId !== 'number'}>Add</button>
        </div>
        <ul style={{ listStyle: 'none', padding: 0, marginTop: '0.5rem' }}>
          {subcategories.map((s) => {
            const cat = categories.find((c) => c.id === s.category_id);
            return (
              <li key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                {editingSubcategoryId === s.id ? (
                  <>
                    <select id={`edit-subcat-cat-${s.id}`} defaultValue={s.category_id} style={{ padding: '0.25rem' }}>
                      {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <input type="text" defaultValue={s.name} id={`edit-subcat-${s.id}`} style={{ padding: '0.25rem', width: '10rem' }} />
                    <button type="button" onClick={() => {
                      const name = (document.getElementById(`edit-subcat-${s.id}`) as HTMLInputElement)?.value?.trim();
                      const category_id = Number((document.getElementById(`edit-subcat-cat-${s.id}`) as HTMLSelectElement)?.value);
                      if (name) api.organization.updateSubcategory(s.id, { name, category_id }).then(() => { setEditingSubcategoryId(null); onRefresh(); onOrganizationChange?.(); }).catch(alert);
                    }}>Save</button>
                    <button type="button" onClick={() => setEditingSubcategoryId(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <span style={{ color: 'var(--text-muted)' }}>{cat?.name ?? '?'} › </span>
                    <span>{s.name}</span>
                    <button type="button" onClick={() => setEditingSubcategoryId(s.id)}>Edit</button>
                    <button type="button" onClick={() => { if (confirm('Delete?')) api.organization.deleteSubcategory(s.id).then(() => { onRefresh(); onOrganizationChange?.(); }).catch(alert); }}>Delete</button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <div>
        <h4>Tags</h4>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
          <input type="text" placeholder="New tag" value={newTagName} onChange={(e) => setNewTagName(e.target.value)} style={{ padding: '0.35rem', width: '10rem' }} />
          <input type="text" placeholder="Color" value={newTagColor} onChange={(e) => setNewTagColor(e.target.value)} style={{ padding: '0.35rem', width: '8rem' }} />
          <button type="button" onClick={() => setColorPickerFor('newTag')}>Pick color</button>
          <button type="button" onClick={addTag} disabled={!newTagName.trim()}>Add</button>
        </div>
        <ColorPickerModal
          open={colorPickerFor === 'newTag'}
          onClose={() => setColorPickerFor(null)}
          value={newTagColor}
          onSelect={(c) => setNewTagColor(c)}
        />
        <ColorPickerModal
          open={colorPickerFor === 'newBlock'}
          onClose={() => setColorPickerFor(null)}
          value={newBlockColor}
          onSelect={(c) => setNewBlockColor(c)}
        />
        {colorPickerFor && typeof colorPickerFor === 'object' && (
          <ColorPickerModal
            open
            onClose={() => setColorPickerFor(null)}
            value={'editCat' in colorPickerFor
              ? (categories.find((x) => x.id === colorPickerFor.editCat)?.color ?? '')
              : 'editTag' in colorPickerFor
                ? (tags.find((x) => x.id === colorPickerFor.editTag)?.color ?? '')
                : (blocks.find((x) => x.id === colorPickerFor.editBlock)?.color ?? '')}
            onSelect={(c) => {
              if ('editCat' in colorPickerFor) {
                const el = document.getElementById(`edit-cat-color-${colorPickerFor.editCat}`) as HTMLInputElement | null;
                if (el) el.value = c;
              } else if ('editTag' in colorPickerFor) {
                const el = document.getElementById(`edit-tag-color-${colorPickerFor.editTag}`) as HTMLInputElement | null;
                if (el) el.value = c;
              } else {
                const el = document.getElementById(`edit-block-color-${colorPickerFor.editBlock}`) as HTMLInputElement | null;
                if (el) el.value = c;
              }
              setColorPickerFor(null);
            }}
          />
        )}
        <ul style={{ listStyle: 'none', padding: 0, marginTop: '0.5rem' }}>
          {tags.map((t) => (
            <li key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
              {editingTagId === t.id ? (
                <>
                  <input type="text" defaultValue={t.name} id={`edit-tag-${t.id}`} style={{ padding: '0.25rem', width: '10rem' }} />
                  <input type="text" defaultValue={t.color ?? ''} placeholder="Color" style={{ padding: '0.25rem', width: '8rem' }} id={`edit-tag-color-${t.id}`} />
                  <button type="button" onClick={() => setColorPickerFor({ editTag: t.id })}>Pick</button>
                  <button type="button" onClick={() => {
                    const name = (document.getElementById(`edit-tag-${t.id}`) as HTMLInputElement)?.value?.trim();
                    const color = (document.getElementById(`edit-tag-color-${t.id}`) as HTMLInputElement)?.value?.trim() || null;
                    if (name) api.organization.updateTag(t.id, { name, color }).then(() => { setEditingTagId(null); onRefresh(); onOrganizationChange?.(); }).catch(alert);
                  }}>Save</button>
                  <button type="button" onClick={() => setEditingTagId(null)}>Cancel</button>
                </>
              ) : (
                <>
                  <span style={{ backgroundColor: t.color ?? 'var(--surface)', padding: '0.15rem 0.5rem', borderRadius: 4, minWidth: '8rem' }}>{t.name}</span>
                  <button type="button" onClick={() => setEditingTagId(t.id)}>Edit</button>
                  <button type="button" onClick={() => { if (confirm('Delete this tag?')) api.organization.deleteTag(t.id).then(() => { onRefresh(); onOrganizationChange?.(); }).catch(alert); }}>Delete</button>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h4>Blocks</h4>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 0.4rem 0' }}>
          Used by the schedule block-out lane.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
          <input type="text" placeholder="New block" value={newBlockName} onChange={(e) => setNewBlockName(e.target.value)} style={{ padding: '0.35rem', width: '10rem' }} />
          <input type="text" placeholder="Color" value={newBlockColor} onChange={(e) => setNewBlockColor(e.target.value)} style={{ padding: '0.35rem', width: '8rem' }} />
          <button type="button" onClick={() => setColorPickerFor('newBlock')}>Pick color</button>
          <OrgIconPickerSelect value={newBlockIcon} onChange={setNewBlockIcon} />
          <button type="button" onClick={addBlock} disabled={!newBlockName.trim()}>Add</button>
        </div>
        <ul style={{ listStyle: 'none', padding: 0, marginTop: '0.5rem' }}>
          {blocks.map((b) => (
            <li key={b.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
              {editingBlockId === b.id ? (
                <>
                  <input type="text" defaultValue={b.name} id={`edit-block-${b.id}`} style={{ padding: '0.25rem', width: '10rem' }} />
                  <input type="text" defaultValue={b.color ?? ''} placeholder="Color" style={{ padding: '0.25rem', width: '8rem' }} id={`edit-block-color-${b.id}`} />
                  <button type="button" onClick={() => setColorPickerFor({ editBlock: b.id })}>Pick</button>
                  <OrgIconPickerSelect id={`edit-block-icon-${b.id}`} value={editBlockIcon} onChange={setEditBlockIcon} />
                  <button type="button" onClick={() => {
                    const name = (document.getElementById(`edit-block-${b.id}`) as HTMLInputElement)?.value?.trim();
                    const color = (document.getElementById(`edit-block-color-${b.id}`) as HTMLInputElement)?.value?.trim() || null;
                    const icon = editBlockIcon.trim() || null;
                    if (name) api.organization.updateBlock(b.id, { name, color, icon }).then(() => { setEditingBlockId(null); onRefresh(); onOrganizationChange?.(); }).catch(alert);
                  }}>Save</button>
                  <button type="button" onClick={() => setEditingBlockId(null)}>Cancel</button>
                </>
              ) : (
                <>
                  <span style={{ backgroundColor: b.color ?? 'var(--surface)', padding: '0.15rem 0.5rem', borderRadius: 4, minWidth: '8rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                    <OrgLucideIcon name={b.icon} size={14} />
                    {b.name}
                  </span>
                  <button type="button" onClick={() => { setEditingBlockId(b.id); setEditBlockIcon(b.icon ?? ''); }}>Edit</button>
                  <button type="button" onClick={() => { if (confirm('Delete this block?')) api.organization.deleteBlock(b.id).then(() => { onRefresh(); onOrganizationChange?.(); }).catch(alert); }}>Delete</button>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
