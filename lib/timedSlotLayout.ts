import type { ScheduledSlot } from '@/lib/api';
import { resolveGroupMemberTimes } from '@/lib/scheduleSlotMath';
import { MINUTES_PER_DAY, slotDurationMinutes, slotSpansNextDay } from '@/lib/overnightSlotTimes';

function timeToMinutes(time: string | null | undefined): number {
  if (time == null || time === '') return 0;
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Root row end_time can lag grouped child rows in DB. Layout and overlap should use
 * max(root end, child ends) so the block is not drawn one-interval tall.
 * When end <= start, the slot continues into the next calendar day.
 */
export function timedSlotLayoutBounds(slot: ScheduledSlot, childSlots: ScheduledSlot[]): { startMin: number; endMin: number } {
  const startMin = timeToMinutes(slot.start_time);
  if (childSlots.length === 0) {
    if (slotSpansNextDay(slot.start_time, slot.end_time)) {
      return { startMin, endMin: MINUTES_PER_DAY };
    }
    return { startMin, endMin: timeToMinutes(slot.end_time) };
  }
  let endMin = timeToMinutes(slot.end_time);
  for (const c of childSlots) {
    if (slotSpansNextDay(c.start_time, c.end_time)) {
      endMin = Math.max(endMin, MINUTES_PER_DAY);
    } else {
      endMin = Math.max(endMin, timeToMinutes(c.end_time));
    }
  }
  if (slotSpansNextDay(slot.start_time, slot.end_time)) {
    endMin = Math.max(endMin, MINUTES_PER_DAY);
  }
  return { startMin, endMin };
}

export { slotDurationMinutes };

/**
 * Per-member slot times for a schedule group, matching on-screen segment
 * boundaries (root first, then children in order_index order).
 */
export function computeGroupMemberSlotTimes(
  rootSlot: ScheduledSlot,
  orderedChildren: ScheduledSlot[],
  groupStartMin: number,
  groupEndMin: number,
  slotDurationMinutes: number
): Array<{ slot: ScheduledSlot; startMin: number; endMin: number }> {
  const members = [rootSlot, ...orderedChildren];
  const times = resolveGroupMemberTimes({
    groupStartMin,
    groupEndMin,
    orderedChildren,
    slotDurationMinutes,
  });
  return members.map((slot, i) => ({
    slot,
    startMin: times[i]!.startMin,
    endMin: times[i]!.endMin,
  }));
}
