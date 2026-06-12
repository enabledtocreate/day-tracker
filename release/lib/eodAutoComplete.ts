'use client';

/**
 * Client-side End-Of-Day runner for the `auto_complete_eod` task flag.
 *
 * Per `.apm/_WORKSPACE/TODO-mobile.md §0.7 / §0.9 Step 8`:
 *   - On app load + on `visibilitychange` → "visible", check whether the local
 *     calendar date has advanced since the last time the runner saw it.
 *   - If it has, the date that just ended = previous local date. Fetch every
 *     scheduled slot for that date, look up the parent task, and if the task
 *     has `auto_complete_eod === true` and the slot is uncompleted, mark the
 *     slot complete via `api.slots.update({ completed: true })`.
 *   - Persist the latest local date in `localStorage` so a subsequent reload on
 *     the same day does not re-run the loop.
 *
 * Grouped tasks are individual tasks (see spec answer); the runner treats them
 * one slot at a time so the existing grouping has no special-case impact.
 *
 * Failures are swallowed and logged; the runner must never block the UI.
 */

import { useEffect, useRef } from 'react';
import { api } from '@/lib/api';

const STORAGE_KEY = 'daytracker.eodAutoComplete.lastSeenDate';

function localDateString(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function previousDateString(today: string): string {
  // today is YYYY-MM-DD in LOCAL time. Subtract one day using a local Date.
  const [y, m, d] = today.split('-').map((s) => parseInt(s, 10));
  if (!y || !m || !d) return today;
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - 1);
  return localDateString(dt);
}

async function runEodSweep(endedDate: string): Promise<{ swept: number; failed: number }> {
  let swept = 0;
  let failed = 0;
  try {
    const [{ byDate }, { tasks }] = await Promise.all([
      api.slots.listByDateRange(endedDate, endedDate),
      api.tasks.list({}),
    ]);
    const slots = byDate[endedDate] ?? [];
    const tasksById = new Map<number, (typeof tasks)[number]>();
    for (const t of tasks) tasksById.set(t.id, t);
    for (const slot of slots) {
      if (slot.completed) continue;
      const t = tasksById.get(slot.task_id);
      if (!t || !t.auto_complete_eod) continue;
      try {
        await api.slots.update({ id: slot.id, completed: true });
        swept += 1;
      } catch {
        failed += 1;
      }
    }
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('[eodAutoComplete] sweep failed', err);
  }
  return { swept, failed };
}

/**
 * Mount once near the app root (e.g. `MainApp.tsx`) after the user is logged in.
 * Safe to mount multiple times — the localStorage guard prevents double runs.
 */
export function useEodAutoComplete(enabled: boolean): void {
  const runningRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;

    const check = async () => {
      if (runningRef.current) return;
      runningRef.current = true;
      try {
        const today = localDateString();
        let lastSeen: string | null = null;
        try {
          lastSeen = window.localStorage.getItem(STORAGE_KEY);
        } catch {
          /* localStorage unavailable; treat as first-ever run, do nothing */
          return;
        }
        if (!lastSeen) {
          try {
            window.localStorage.setItem(STORAGE_KEY, today);
          } catch {
            /* swallow */
          }
          return;
        }
        if (lastSeen === today) return;
        // Sweep every day between lastSeen+1 and yesterday (inclusive). The most
        // common case is exactly one day; we handle long absences by walking forward.
        let cursor = lastSeen;
        const yesterday = previousDateString(today);
        const safetyLimit = 14; // never sweep more than 14 days at once
        let walked = 0;
        while (cursor !== today && walked < safetyLimit) {
          if (cursor !== '' && cursor !== today) {
            await runEodSweep(cursor);
          }
          const next = previousDateString(cursor);
          // Walk forward: the previous of cursor is `next`, so the day after cursor is...
          // we need next-day-of-cursor; recompute properly.
          const [yy, mm, dd] = cursor.split('-').map((s) => parseInt(s, 10));
          if (!yy || !mm || !dd) break;
          const dt = new Date(yy, mm - 1, dd);
          dt.setDate(dt.getDate() + 1);
          cursor = localDateString(dt);
          walked += 1;
          if (cursor > yesterday) break;
          void next; // unused: previousDateString call above is harmless
        }
        try {
          window.localStorage.setItem(STORAGE_KEY, today);
        } catch {
          /* swallow */
        }
      } finally {
        runningRef.current = false;
      }
    };

    void check();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [enabled]);
}
