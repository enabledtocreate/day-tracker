'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import type { IcalSubscriptionRow } from '@/lib/api';
import { ViewFeedModal } from '@/components/ViewFeedModal';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';

type Props = {
  sub: IcalSubscriptionRow;
  onRemove: (id: number) => void;
  onListChange: () => void;
};

export function SubscriptionRow({ sub, onRemove, onListChange }: Props) {
  const [viewFeedOpen, setViewFeedOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState(sub.display_name?.trim() ?? '');
  const [feedUrlDraft, setFeedUrlDraft] = useState(sub.feed_url);

  useEffect(() => {
    setNicknameDraft(sub.display_name?.trim() ?? '');
    setFeedUrlDraft(sub.feed_url);
  }, [sub.id, sub.display_name, sub.feed_url]);

  const handleToggleEnabled = () => {
    api.icalSubscriptions.setEnabled(sub.id, !sub.enabled).then(onListChange).catch(alert);
  };

  const commitNickname = () => {
    const v = nicknameDraft.trim();
    if (v === (sub.display_name?.trim() ?? '')) return;
    api.icalSubscriptions.setDisplayName(sub.id, v).then(onListChange).catch(alert);
  };

  const openEdit = () => {
    setFeedUrlDraft(sub.feed_url);
    setEditOpen(true);
  };

  const commitFeedUrl = () => {
    const next = feedUrlDraft.trim();
    if (!next || next === sub.feed_url.trim()) {
      setEditOpen(false);
      return;
    }
    api.icalSubscriptions.setFeedUrl(sub.id, next).then(() => {
      setEditOpen(false);
      onListChange();
    }).catch(alert);
  };

  const fallbackName = (() => {
    if (sub.display_name?.trim()) return sub.display_name.trim();
    try {
      const u = new URL(sub.feed_url);
      return u.hostname;
    } catch {
      return `Calendar #${sub.id}`;
    }
  })();

  return (
    <>
      <div className="subscription-row-item">
        <div className="subscription-row-main">
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <input type="checkbox" checked={sub.enabled !== false} onChange={handleToggleEnabled} />
            Show on Schedule
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', minWidth: '16rem' }}>
            Nickname
            <input
              type="text"
              value={nicknameDraft}
              placeholder={fallbackName}
              onChange={(e) => setNicknameDraft(e.target.value)}
              onBlur={commitNickname}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  (e.target as HTMLInputElement).blur();
                }
              }}
              style={{ maxWidth: '14rem' }}
            />
          </label>
          <div className="subscription-row-actions">
            <button type="button" className="subscription-icon-btn" title="View feed" aria-label="View feed" onClick={() => setViewFeedOpen(true)}>👁</button>
            <button type="button" className="subscription-icon-btn" title="Edit URL" aria-label="Edit URL" onClick={openEdit}>✎</button>
            <button type="button" className="subscription-icon-btn" title="Remove calendar" aria-label="Remove calendar" onClick={() => onRemove(sub.id)}>🗑</button>
          </div>
        </div>
        <div className="subscription-row-url">
          <input type="text" value={sub.feed_url} readOnly title={sub.feed_url} />
          <button type="button" onClick={openEdit}>Update</button>
        </div>
      </div>
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit calendar URL"
        actions={
          <>
            <Button onClick={commitFeedUrl}>Update</Button>
            <Button onClick={() => setEditOpen(false)}>Cancel</Button>
          </>
        }
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          iCal URL
          <input
            type="url"
            value={feedUrlDraft}
            onChange={(e) => setFeedUrlDraft(e.target.value)}
            placeholder="https://…"
          />
        </label>
      </Modal>
      <ViewFeedModal subscriptionId={sub.id} open={viewFeedOpen} onClose={() => setViewFeedOpen(false)} />
    </>
  );
}
