'use client';

import { useEffect, useRef } from 'react';
import { api } from '@/lib/api';

export const DEFAULT_DATA_SYNC_POLL_MS = 15_000;

export type DataSyncPollOptions = {
  enabled?: boolean;
  intervalMs?: number;
  /** Skip polling while local writes are in flight. */
  pendingWritesRef: React.MutableRefObject<number>;
  lastRevisionRef: React.MutableRefObject<string | null>;
  onRemoteChange: () => void;
  isPaused?: () => boolean;
};

/**
 * Polls `api/sync` and calls `onRemoteChange` when another device (or tab) changed data.
 */
export function useDataSyncPoll({
  enabled = true,
  intervalMs = DEFAULT_DATA_SYNC_POLL_MS,
  pendingWritesRef,
  lastRevisionRef,
  onRemoteChange,
  isPaused,
}: DataSyncPollOptions): void {
  const onRemoteChangeRef = useRef(onRemoteChange);
  onRemoteChangeRef.current = onRemoteChange;

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const tick = async () => {
      if (cancelled || typeof document === 'undefined') return;
      if (document.hidden) return;
      if (isPaused?.()) return;
      if (pendingWritesRef.current > 0) return;

      try {
        const sync = await api.sync.get();
        if (cancelled) return;

        const revision = sync.revision;
        if (lastRevisionRef.current === null) {
          lastRevisionRef.current = revision;
          return;
        }
        if (revision !== lastRevisionRef.current) {
          lastRevisionRef.current = revision;
          onRemoteChangeRef.current();
        }
      } catch {
        /* ignore transient network errors */
      }
    };

    void tick();
    const id = window.setInterval(() => {
      void tick();
    }, intervalMs);

    const onVisible = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, intervalMs, pendingWritesRef, lastRevisionRef, isPaused]);
}

export async function adoptServerDataRevision(
  lastRevisionRef: React.MutableRefObject<string | null>
): Promise<void> {
  try {
    const sync = await api.sync.get();
    lastRevisionRef.current = sync.revision;
  } catch {
    /* ignore */
  }
}
