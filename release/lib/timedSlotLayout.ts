import type { ScheduledSlot } from '@/lib/api';
import { resolveGroupMemberTimes } from '@/lib/scheduleSlotMath';

function timeToMinutes(time: string | null | undefined): number {
  if (time == null || time === '') return 0;
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Root row end_time can lag grouped child rows in DB. Layout and overlap should use
 * max(root end, child ends) so the block is not drawn one-interval tall.
 */
export function timedSlotLayoutBounds(slot: ScheduledSlot, childSlots: ScheduledSlot[]): { startMin: number; endMin: number } {
  const startMin = timeToMinutes(slot.start_time);
  let endMin = timeToMinutes(slot.end_time);
  if (childSlots.length === 0) return { startMin, endMin };
  for (const c of childSlots) {
    endMin = Math.max(endMin, timeToMinutes(c.end_time));
  }
  return { startMin, endMin };
}

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
