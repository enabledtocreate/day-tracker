import type { IcalFeedEvent, ScheduledSlot } from '@/lib/api';
import { icalEventToLocal } from '@/lib/icalTimezone';

/** "09:00" / "09:00:00" → "9:00 AM" */
export function formatCalendarClock12h(time: string): string {
  const parts = time.trim().split(':');
  const h = parseInt(parts[0] ?? '0', 10);
  const m = parseInt(parts[1] ?? '0', 10);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

export function formatSlotTimeLabel(slot: ScheduledSlot): string | null {
  if (!slot.start_time || !slot.end_time) return null;
  return `${formatCalendarClock12h(slot.start_time)} – ${formatCalendarClock12h(slot.end_time)}`;
}

export function formatFeedEventTimeLabel(event: IcalFeedEvent, timezone?: string): string | null {
  if (event.allDay) return null;
  const local = icalEventToLocal(event.start, event.end, false, timezone);
  if (!local.localStartTime || !local.localEndTime) return null;
  return `${formatCalendarClock12h(local.localStartTime)} – ${formatCalendarClock12h(local.localEndTime)}`;
}

export function slotSortMinutes(slot: ScheduledSlot): number {
  if (!slot.start_time) return Number.MAX_SAFE_INTEGER;
  const [h, m] = slot.start_time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
