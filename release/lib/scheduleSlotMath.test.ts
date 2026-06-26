import { describe, it, expect } from 'vitest';
import type { ScheduledSlot } from '@/lib/api';
import {
  clampGroupBoundaryAtIndex,
  groupInternalBoundaries,
  groupSlotTimesFromBoundaries,
  resolveGroupMemberTimes,
} from '@/lib/scheduleSlotMath';

describe('group boundary layout', () => {
  const groupStart = 16 * 60 + 15;
  const groupEnd = 17 * 60 + 15;
  const collidingChildren = [
    { id: 1, start_time: '16:15', end_time: '16:45' },
    { id: 2, start_time: '16:15', end_time: '17:15' },
  ] as ScheduledSlot[];

  it('groupInternalBoundaries matches resolved display splits', () => {
    const boundaries = groupInternalBoundaries({
      groupStartMin: groupStart,
      groupEndMin: groupEnd,
      orderedChildren: collidingChildren,
      slotDurationMinutes: 15,
    });
    expect(boundaries).toEqual([16 * 60 + 30, 16 * 60 + 45]);
    const times = resolveGroupMemberTimes({
      groupStartMin: groupStart,
      groupEndMin: groupEnd,
      orderedChildren: collidingChildren,
      slotDurationMinutes: 15,
    });
    expect(times.map((t) => t.startMin)).toEqual([groupStart, 16 * 60 + 30, 16 * 60 + 45]);
  });

  it('clampGroupBoundaryAtIndex snaps to interval grid between neighbors', () => {
    const start = 16 * 60;
    const end = 18 * 60;
    const boundaries = [16 * 60 + 45, 17 * 60 + 30];
    const moved = clampGroupBoundaryAtIndex({
      boundaryIndex: 0,
      candidateMin: 16 * 60 + 52,
      boundaries,
      groupStartMin: start,
      groupEndMin: end,
      slotDurationMinutes: 15,
      startHour: 8,
      endHour: 22,
    });
    expect(moved).toBe(16 * 60 + 45);
  });

  it('groupSlotTimesFromBoundaries updates root and each child segment', () => {
    const boundaries = [16 * 60 + 30, 16 * 60 + 45];
    const { root, children } = groupSlotTimesFromBoundaries(groupStart, groupEnd, boundaries);
    expect(root).toEqual({ startMin: groupStart, endMin: groupEnd });
    expect(children).toEqual([
      { startMin: 16 * 60 + 30, endMin: 16 * 60 + 45 },
      { startMin: 16 * 60 + 45, endMin: groupEnd },
    ]);
  });
});
