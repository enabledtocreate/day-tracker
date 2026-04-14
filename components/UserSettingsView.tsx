'use client';

import { useState, useEffect, useCallback } from 'react';
import type { AuthUser } from '@/lib/auth';
import { api } from '@/lib/api';
import { getBaseUrl } from '@/lib/getBaseUrl';
import { SubscriptionRow } from '@/components/SubscriptionRow';
import { ColorPickerModal, randomScheduleFriendlyColor } from '@/components/ColorPickerModal';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import type { TimeSettings, IcalSubscriptionRow } from '@/lib/api';
import { DT } from '@/lib/uiIdentifiers';

type SectionId = 'profile' | 'subscriptions' | 'schedule' | 'organization';

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
  { id: 'organization', label: 'Organization' },
];

export function UserSettingsView({ user, onClose, onUserUpdated, onOrganizationChange }: Props) {
  const [section, setSection] = useState<SectionId>('profile');
  const [newPassword, setNewPassword] = useState('');
  const [feedUrl, setFeedUrl] = useState('');
  const [subscriptions, setSubscriptions] = useState<IcalSubscriptionRow[]>([]);
  const [addUrl, setAddUrl] = useState('');
  const [settings, setSettings] = useState<TimeSettings | null>(null);
  const [organizationCategories, setOrganizationCategories] = useState<Array<{ id: number; name: string; color?: string | null }>>([]);
  const [organizationSubcategories, setOrganizationSubcategories] = useState<Array<{ id: number; category_id: number; name: string }>>([]);
  const [organizationTags, setOrganizationTags] = useState<Array<{ id: number; name: string; color?: string | null }>>([]);
  const [excludedIcalOpen, setExcludedIcalOpen] = useState(false);
  const [excludedIcalList, setExcludedIcalList] = useState<Array<{ uid: string; title: string }>>([]);

  useEffect(() => {
    api.icalFeed.getUrl().then(({ token }) => {
      const base = getBaseUrl().replace(/\/$/, '');
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const path = base ? `${base}/api/ical.php` : 'api/ical.php';
      setFeedUrl(`${origin}/${path}?token=${encodeURIComponent(token)}`);
    }).catch(() => setFeedUrl(''));
    api.icalSubscriptions.list().then(({ subscriptions: subs }) => setSubscriptions(subs)).catch(() => {});
  }, []);

  const loadSettings = useCallback(() => {
    api.settings.get().then(setSettings).catch(() => setSettings(null));
  }, []);
  const loadOrganization = useCallback(() => {
    api.organization.list().then((r) => {
      setOrganizationCategories(r.categories ?? []);
      setOrganizationSubcategories(r.subcategories ?? []);
      setOrganizationTags(r.tags ?? []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (section === 'schedule') loadSettings();
  }, [section, loadSettings]);
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
              color: section === s.id ? 'var(--bg)' : 'var(--text)',
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
            </>
          )}
        </div>
      )}

      {section === 'organization' && (
        <div className="user-settings-section">
          <h3 style={{ marginTop: 0 }}>Organization</h3>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Categories, subcategories, and tags for tasks. Set colors for categories and tags.</p>
          <OrganizationCrud
            categories={organizationCategories}
            subcategories={organizationSubcategories}
            tags={organizationTags}
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
  onRefresh,
  onOrganizationChange,
}: {
  categories: Array<{ id: number; name: string; color?: string | null }>;
  subcategories: Array<{ id: number; category_id: number; name: string }>;
  tags: Array<{ id: number; name: string; color?: string | null }>;
  onRefresh: () => void;
  onOrganizationChange?: () => void;
}) {
  const [newCatName, setNewCatName] = useState('');
  const [newCatColor, setNewCatColor] = useState('');
  const [newSubcatCategoryId, setNewSubcatCategoryId] = useState<number | ''>('');
  const [newSubcatName, setNewSubcatName] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('');
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [editingSubcategoryId, setEditingSubcategoryId] = useState<number | null>(null);
  const [editingTagId, setEditingTagId] = useState<number | null>(null);
  const [colorPickerFor, setColorPickerFor] = useState<null | 'newCat' | 'newTag' | { editCat: number } | { editTag: number }>(null);

  const addCategory = () => {
    const name = newCatName.trim();
    if (!name) return;
    const color = newCatColor.trim() || randomScheduleFriendlyColor();
    api.organization.createCategory({ name, color }).then(() => { setNewCatName(''); setNewCatColor(''); onRefresh(); onOrganizationChange?.(); }).catch(alert);
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginTop: '1rem' }}>
      <div>
        <h4>Categories</h4>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
          <input type="text" placeholder="New category" value={newCatName} onChange={(e) => setNewCatName(e.target.value)} style={{ padding: '0.35rem', width: '10rem' }} />
          <input type="text" placeholder="Color" value={newCatColor} onChange={(e) => setNewCatColor(e.target.value)} style={{ padding: '0.35rem', width: '8rem' }} />
          <button type="button" onClick={() => setColorPickerFor('newCat')}>Pick color</button>
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
                  <button type="button" onClick={() => {
                    const name = (document.getElementById(`edit-cat-${c.id}`) as HTMLInputElement)?.value?.trim();
                    const color = (document.getElementById(`edit-cat-color-${c.id}`) as HTMLInputElement)?.value?.trim() || null;
                    if (name) api.organization.updateCategory(c.id, { name, color }).then(() => { setEditingCategoryId(null); onRefresh(); onOrganizationChange?.(); }).catch(alert);
                  }}>Save</button>
                  <button type="button" onClick={() => setEditingCategoryId(null)}>Cancel</button>
                </>
              ) : (
                <>
                  <span style={{ backgroundColor: c.color ?? 'var(--surface)', padding: '0.15rem 0.5rem', borderRadius: 4, minWidth: '8rem' }}>{c.name}</span>
                  <button type="button" onClick={() => setEditingCategoryId(c.id)}>Edit</button>
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
        {colorPickerFor && typeof colorPickerFor === 'object' && (
          <ColorPickerModal
            open
            onClose={() => setColorPickerFor(null)}
            value={'editCat' in colorPickerFor
              ? (categories.find((x) => x.id === colorPickerFor.editCat)?.color ?? '')
              : (tags.find((x) => x.id === colorPickerFor.editTag)?.color ?? '')}
            onSelect={(c) => {
              if ('editCat' in colorPickerFor) {
                const el = document.getElementById(`edit-cat-color-${colorPickerFor.editCat}`) as HTMLInputElement | null;
                if (el) el.value = c;
              } else {
                const el = document.getElementById(`edit-tag-color-${colorPickerFor.editTag}`) as HTMLInputElement | null;
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
    </div>
  );
}
