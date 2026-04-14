'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import type { IcalSubscriptionRow } from '@/lib/api';
import { ViewFeedModal } from '@/components/ViewFeedModal';

type Props = {
  sub: IcalSubscriptionRow;
  onRemove: (id: number) => void;
  onListChange: () => void;
};

export function SubscriptionRow({ sub, onRemove, onListChange }: Props) {
  const [viewFeedOpen, setViewFeedOpen] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState(sub.display_name?.trim() ?? '');

  useEffect(() => {
    setNicknameDraft(sub.display_name?.trim() ?? '');
  }, [sub.id, sub.display_name]);

  const handleToggleEnabled = () => {
    api.icalSubscriptions.setEnabled(sub.id, !sub.enabled).then(onListChange).catch(alert);
  };

  const commitNickname = () => {
    const v = nicknameDraft.trim();
    if (v === (sub.display_name?.trim() ?? '')) return;
    api.icalSubscriptions.setDisplayName(sub.id, v).then(onListChange).catch(alert);
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <input type="checkbox" checked={sub.enabled !== false} onChange={handleToggleEnabled} />
          Show on schedule
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', fontSize: '0.8rem', minWidth: '8rem' }}>
          <span>Nickname</span>
          <input
            type="text"
            value={nicknameDraft}
            placeholder="e.g. Work calendar"
            onChange={(e) => setNicknameDraft(e.target.value)}
            onBlur={commitNickname}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                (e.target as HTMLInputElement).blur();
              }
            }}
            style={{ maxWidth: '16rem' }}
          />
        </label>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1 1 8rem', minWidth: 0 }} title={sub.feed_url}>
          {sub.feed_url}
        </span>
        <button type="button" onClick={() => setViewFeedOpen(true)}>View Feed</button>
        <button type="button" onClick={() => onRemove(sub.id)}>Remove</button>
      </div>
      <ViewFeedModal subscriptionId={sub.id} open={viewFeedOpen} onClose={() => setViewFeedOpen(false)} />
    </>
  );
}
