'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { ViewFeedModal } from '@/components/ViewFeedModal';

type Sub = { id: number; feed_url: string; enabled: boolean };

type Props = {
  sub: Sub;
  onRemove: (id: number) => void;
  onListChange: () => void;
};

export function SubscriptionRow({ sub, onRemove, onListChange }: Props) {
  const [viewFeedOpen, setViewFeedOpen] = useState(false);

  const handleToggleEnabled = () => {
    api.icalSubscriptions.setEnabled(sub.id, !sub.enabled).then(onListChange).catch(alert);
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <input type="checkbox" checked={sub.enabled !== false} onChange={handleToggleEnabled} />
          Show on schedule
        </label>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1 1 8rem', minWidth: 0 }}>{sub.feed_url}</span>
        <button type="button" onClick={() => setViewFeedOpen(true)}>View Feed</button>
        <button type="button" onClick={() => onRemove(sub.id)}>Remove</button>
      </div>
      <ViewFeedModal subscriptionId={sub.id} open={viewFeedOpen} onClose={() => setViewFeedOpen(false)} />
    </>
  );
}
