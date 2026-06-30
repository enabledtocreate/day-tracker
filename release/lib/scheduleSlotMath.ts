import type { ScheduledSlot } from '@/lib/api';
import {
  latestStartMinForDuration,
  MINUTES_PER_DAY,
  storedEndTimeFromDuration,
} from '@/lib/overnightSlotTimes';

export function timeToMinutes(time: string | null | undefined): number {
  if (time == null || time === '') return 0;
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function minutesToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

/**
 * Snap absolute minutes to the schedule grid.
 * Use `kind: 'end'` when snapping a block's `end_time`: it may equal `end_hour * 60`.
 */
export function snapToSlot(
  minutes: number,
  startHour: number,
  endHour: number,
  slotDuration: number,
  kind: 'start' | 'end' = 'start'
): number {
  const start = startHour * 60;
  const end = endHour * 60;
  const step = Math.max(1, slotDuration);
  const offset = minutes - start;
  const slot = Math.round(offset / step) * step + start;
  const upperBound = kind === 'end' ? end : end - step;
  return Math.max(start, Math.min(upperBound, slot));
}

export function clampTopResizeStartForMinDuration(params: {
  candidateStartMin: number;
  endMin: number;
  slotDurationMinutes: number;
}): number {
  const step = Math.max(1, params.slotDurationMinutes);
  return Math.min(params.candidateStartMin, params.endMin - step);
}

export function clampBottomResizeEndForMinDuration(params: {
  startMin: number;
  candidateEndMin: number;
  slotDurationMinutes: number;
}): number {
  const step = Math.max(1, params.slotDurationMinutes);
  return Math.max(params.candidateEndMin, params.startMin + step);
}

export function clampTopResizeStartForMinGroupDuration(params: {
  candidateStartMin: number;
  endMin: number;
  slotDurationMinutes: number;
  memberCount: number;
  startHour: number;
  endHour: number;
  currentStartMin?: number;
}): number {
  const step = Math.max(1, params.slotDurationMinutes);
  const minTotal = Math.max(1, params.memberCount) * step;
  let maxStart = params.endMin - minTotal;
  if (params.currentStartMin !== undefined) {
    const span = params.endMin - params.currentStartMin;
    if (span < minTotal) {
      maxStart = Math.max(maxStart, params.currentStartMin);
    }
  }
  const dayStart = params.startHour * 60;
  if (maxStart < dayStart) {
    return params.currentStartMin ?? dayStart;
  }
  let s = Math.min(params.candidateStartMin, maxStart);
  s = Math.max(dayStart, s);
  s = snapToSlot(s, params.startHour, params.endHour, step);
  if (s > maxStart) {
    const k = Math.max(0, Math.floor((maxStart - dayStart) / step));
    s = dayStart + k * step;
  }
  return s;
}

export function clampBottomResizeEndForMinGroupDuration(params: {
  startMin: number;
  candidateEndMin: number;
  slotDurationMinutes: number;
  memberCount: number;
}): number {
  const step = Math.max(1, params.slotDurationMinutes);
  const minTotal = Math.max(1, params.memberCount) * step;
  return Math.max(params.candidateEndMin, params.startMin + minTotal);
}

export function distributeGroupMemberTimes(params: {
  groupStartMin: number;
  groupEndMin: number;
  slotDurationMinutes: number;
  memberCount: number;
}): Array<{ startMin: number; endMin: number }> {
  const memberCount = Math.max(1, params.memberCount | 0);
  const totalMin = Math.max(0, params.groupEndMin - params.groupStartMin);
  const slotDur = params.slotDurationMinutes;
  const totalIntervals = slotDur > 0 ? Math.round(totalMin / slotDur) : 0;
  const baseIntervals = memberCount > 0 ? Math.floor(totalIntervals / memberCount) : 0;
  const remainderIntervals = memberCount > 0 ? totalIntervals - baseIntervals * memberCount : 0;

  const out: Array<{ startMin: number; endMin: number }> = [];
  let cur = params.groupStartMin;
  for (let i = 0; i < memberCount; i++) {
    const intervalsForThis = baseIntervals + (i === memberCount - 1 ? remainderIntervals : 0);
    const startMin = cur;
    const endMin = cur + intervalsForThis * slotDur;
    out.push({ startMin, endMin });
    cur = endMin;
  }
  return out;
}

/** Interval count for a timed range on the schedule grid (minimum 1). */
export function slotRangeIntervalCount(
  startMin: number,
  endMin: number,
  slotDurationMinutes: number,
  minIntervals = 1
): number {
  const step = Math.max(1, slotDurationMinutes);
  let span = endMin - startMin;
  if (span <= 0) span += MINUTES_PER_DAY;
  return Math.max(minIntervals, Math.round(span / step));
}

/**
 * Per-member times for a schedule group. Uses explicit child start boundaries when
 * valid; otherwise distributes evenly in interval multiples.
 */
export function resolveGroupMemberTimes(params: {
  groupStartMin: number;
  groupEndMin: number;
  orderedChildren: ScheduledSlot[];
  slotDurationMinutes: number;
}): Array<{ startMin: number; endMin: number }> {
  const step = Math.max(1, params.slotDurationMinutes);
  const memberCount = 1 + params.orderedChildren.length;
  const distributed = distributeGroupMemberTimes({
    groupStartMin: params.groupStartMin,
    groupEndMin: params.groupEndMin,
    slotDurationMinutes: step,
    memberCount,
  });
  if (params.orderedChildren.length === 0) {
    return distributed;
  }

  const rawStarts = params.orderedChildren.map((c) => timeToMinutes(c.start_time));
  let prev = params.groupStartMin;
  let valid = true;
  for (const s of rawStarts) {
    if (s <= prev || s >= params.groupEndMin || s - prev < step) {
      valid = false;
      break;
    }
    prev = s;
  }
  if (!valid) {
    return distributed;
  }

  const bounds = [params.groupStartMin, ...rawStarts, params.groupEndMin];
  return Array.from({ length: memberCount }, (_, i) => {
    const startMin = bounds[i]!;
    let endMin = bounds[i + 1]!;
    if (endMin - startMin < step) {
      endMin = startMin + step;
    }
    return { startMin, endMin };
  });
}

export function calcMovedSlotTimes(params: {
  scheduleDropStartMin: number;
  viewEndMin: number;
  slotDurationMinutes: number;
  originalDurationMin: number;
  startHour: number;
  endHour: number;
  allowOvernight?: boolean;
}): { newStartMin: number; newEndMin: number; preservedDurationMin: number; end_time: string } {
  const preservedDurationMin = Math.max(0, Math.max(params.originalDurationMin, params.slotDurationMinutes));
  const allowOvernight = params.allowOvernight !== false;
  const latestStartMin = latestStartMinForDuration(
    preservedDurationMin,
    params.startHour,
    params.endHour,
    params.slotDurationMinutes,
    allowOvernight
  );
  const candidateStartMin = Math.min(params.scheduleDropStartMin, latestStartMin);
  const snappedStartMin = snapToSlot(candidateStartMin, params.startHour, params.endHour, params.slotDurationMinutes);
  const newStartMin = Math.min(snappedStartMin, latestStartMin);
  const end_time = storedEndTimeFromDuration(newStartMin, preservedDurationMin);
  const overnight = newStartMin + preservedDurationMin > MINUTES_PER_DAY;
  const newEndMin = overnight ? MINUTES_PER_DAY : newStartMin + preservedDurationMin;
  return { newStartMin, newEndMin, preservedDurationMin, end_time };
}

export function buildGroupSegmentHeightsPx(params: {
  groupStartMin: number;
  groupEndMin: number;
  orderedChildren: ScheduledSlot[];
  slotDurationMinutes: number;
  rowHeightPx: number;
}): number[] {
  const step = Math.max(1, params.slotDurationMinutes);
  const memberTimes = resolveGroupMemberTimes({
    groupStartMin: params.groupStartMin,
    groupEndMin: params.groupEndMin,
    orderedChildren: params.orderedChildren,
    slotDurationMinutes: step,
  });
  return memberTimes.map(({ startMin, endMin }) => {
    const intervals = Math.max(1, Math.round((endMin - startMin) / step));
    return intervals * params.rowHeightPx;
  });
}

/** Internal split minutes between stacked group members (length = child count). */
export function groupInternalBoundaries(params: {
  groupStartMin: number;
  groupEndMin: number;
  orderedChildren: ScheduledSlot[];
  slotDurationMinutes: number;
}): number[] {
  const memberTimes = resolveGroupMemberTimes(params);
  const childCount = params.orderedChildren.length;
  return Array.from({ length: childCount }, (_, i) => memberTimes[i + 1]!.startMin);
}

export function clampGroupBoundaryAtIndex(params: {
  boundaryIndex: number;
  candidateMin: number;
  boundaries: number[];
  groupStartMin: number;
  groupEndMin: number;
  slotDurationMinutes: number;
  startHour: number;
  endHour: number;
}): number {
  const step = Math.max(1, params.slotDurationMinutes);
  const { boundaryIndex: b, boundaries, groupStartMin, groupEndMin } = params;
  const prevEdge = b === 0 ? groupStartMin : boundaries[b - 1]!;
  const nextEdge = b < boundaries.length - 1 ? boundaries[b + 1]! : groupEndMin;
  const lo = prevEdge + step;
  const hi = nextEdge - step;
  let snapped = snapToSlot(params.candidateMin, params.startHour, params.endHour, step);
  snapped = Math.max(lo, Math.min(hi, snapped));
  return snapped;
}

/** Slot times for root + children from internal boundary splits (matches resize/move persistence). */
export function groupSlotTimesFromBoundaries(
  groupStartMin: number,
  groupEndMin: number,
  boundaries: number[]
): {
  root: { startMin: number; endMin: number };
  children: Array<{ startMin: number; endMin: number }>;
} {
  const splits = [groupStartMin, ...boundaries, groupEndMin];
  return {
    root: { startMin: groupStartMin, endMin: groupEndMin },
    children: boundaries.map((_, idx) => ({
      startMin: splits[idx + 1]!,
      endMin: splits[idx + 2]!,
    })),
  };
}
