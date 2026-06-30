import { formatLocalYmd } from '@/lib/scheduleDateUtils';

/**
 * Replace iCal feed events for every date in [from, to] (inclusive), then apply
 * `byDate`. Dates outside the range are left unchanged (e.g. past months cached
 * in Today-tab state). Dates inside the range with no events in `byDate` are
 * cleared so removed feed events do not linger in the UI.
 */
export function replaceIcalFeedByDateInRange<T>(
  prev: Record<string, T[]>,
  byDate: Record<string, T[]>,
  from: string,
  to: string
): Record<string, T[]> {
  const next = { ...prev };
  let cursor = from;
  while (cursor <= to) {
    delete next[cursor];
    const d = new Date(cursor + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    cursor = formatLocalYmd(d);
  }
  return { ...next, ...byDate };
}
