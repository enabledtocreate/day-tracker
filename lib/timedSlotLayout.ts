import type { ScheduledSlot } from '@/lib/api';

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
  const step = Math.max(1, slotDurationMinutes);
  const childStarts = orderedChildren.map((c) => timeToMinutes(c.start_time));
  const bounds = [groupStartMin, ...childStarts, groupEndMin];
  const members = [rootSlot, ...orderedChildren];
  return members.map((slot, i) => {
    const startMin = bounds[i]!;
    let endMin = bounds[i + 1]!;
    if (endMin - startMin < step) endMin = startMin + step;
    return { slot, startMin, endMin };
  });
}
