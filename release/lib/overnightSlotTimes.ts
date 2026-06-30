import type { ScheduledSlot } from '@/lib/api';
import { minutesToTime, timeToMinutes } from '@/lib/scheduleSlotMath';

export const MINUTES_PER_DAY = 24 * 60;

/** Stored end_time on or before start_time means the slot continues into the next calendar day. */
export function slotSpansNextDay(
  startTime: string | null | undefined,
  endTime: string | null | undefined
): boolean {
  if (!startTime || !endTime) return false;
  const s = timeToMinutes(startTime);
  const e = timeToMinutes(endTime);
  return e < s;
}

/** Full timed span in minutes (handles overnight when end <= start). */
export function slotDurationMinutes(
  startTime: string | null | undefined,
  endTime: string | null | undefined
): number {
  if (!startTime || !endTime) return 0;
  const s = timeToMinutes(startTime);
  const e = timeToMinutes(endTime);
  if (e > s) return e - s;
  if (e < s) return MINUTES_PER_DAY - s + e;
  return 0;
}

export function endTimeFromStartAndDuration(startMin: number, durationMin: number): string {
  const endMin = ((startMin + durationMin) % MINUTES_PER_DAY + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return minutesToTime(endMin);
}

/** Latest allowed start minute for a given duration (single-day or overnight). */
export function latestStartMinForDuration(
  durationMin: number,
  startHour: number,
  endHour: number,
  slotDurationMinutes: number,
  allowOvernight = true
): number {
  const dayStart = startHour * 60;
  const dayEnd = endHour * 60;
  const step = Math.max(1, slotDurationMinutes);
  const sameDayLatest = Math.max(dayStart, dayEnd - durationMin);
  if (!allowOvernight) return sameDayLatest;
  const overnightLatest = Math.max(dayStart, MINUTES_PER_DAY - step);
  return Math.max(sameDayLatest, overnightLatest);
}

export function addDaysToYmd(dateStr: string, deltaDays: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + deltaDays);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export type ScheduleDaySegment = {
  slot: ScheduledSlot;
  childSlots: ScheduledSlot[];
  startMin: number;
  endMin: number;
  /** Morning portion continuing from the previous calendar day. */
  continuation: boolean;
  overlapKey: number | string;
};

function isRootSlot(slot: ScheduledSlot, daySlots: ScheduledSlot[]): boolean {
  return !slot.parent_id || !daySlots.some((o) => o.task_id === slot.parent_id);
}

function slotHasTime(slot: ScheduledSlot): boolean {
  return !!(slot.start_time && slot.end_time);
}

/**
 * Timed segments visible on viewDate: slots starting that day (evening portion if overnight)
 * plus morning continuations from the previous day.
 */
export function collectScheduleDaySegments(params: {
  allSlots: ScheduledSlot[];
  slotDayByRecordId: Record<number, string>;
  viewDate: string;
  viewStartMinutes: number;
  viewEndMinutes: number;
}): ScheduleDaySegment[] {
  const { allSlots, slotDayByRecordId, viewDate, viewStartMinutes, viewEndMinutes } = params;
  const daySlots = allSlots.filter((s) => slotDayByRecordId[Number(s.day_record_id)] === viewDate);
  const prevDate = addDaysToYmd(viewDate, -1);
  const prevDaySlots = allSlots.filter((s) => slotDayByRecordId[Number(s.day_record_id)] === prevDate);

  const childByParent = new Map<number, ScheduledSlot[]>();
  for (const s of [...daySlots, ...prevDaySlots]) {
    const parentId = s.parent_id;
    if (parentId == null) continue;
    const list = childByParent.get(parentId) ?? [];
    list.push(s);
    childByParent.set(parentId, list);
  }

  const segments: ScheduleDaySegment[] = [];

  for (const slot of daySlots) {
    if (!slotHasTime(slot) || !isRootSlot(slot, daySlots)) continue;
    const childSlots = childByParent.get(slot.task_id) ?? [];
    if (childSlots.length > 0) continue;
    const startMin = timeToMinutes(slot.start_time);
    const overnight = slotSpansNextDay(slot.start_time, slot.end_time);
    const endMin = overnight ? Math.min(MINUTES_PER_DAY, viewEndMinutes) : timeToMinutes(slot.end_time);
    if (endMin <= startMin && !overnight) continue;
    if (endMin <= viewStartMinutes) continue;
    segments.push({
      slot,
      childSlots,
      startMin: Math.max(startMin, viewStartMinutes),
      endMin,
      continuation: false,
      overlapKey: slot.id,
    });
  }

  for (const slot of prevDaySlots) {
    if (!slotHasTime(slot) || !isRootSlot(slot, prevDaySlots)) continue;
    if (!slotSpansNextDay(slot.start_time, slot.end_time)) continue;
    const childSlots = childByParent.get(slot.task_id) ?? [];
    if (childSlots.length > 0) continue;
    const endMin = timeToMinutes(slot.end_time);
    if (endMin <= viewStartMinutes) continue;
    segments.push({
      slot,
      childSlots,
      startMin: viewStartMinutes,
      endMin: Math.min(endMin, viewEndMinutes),
      continuation: true,
      overlapKey: `${slot.id}-overnight`,
    });
  }

  return segments;
}

export function segmentIntervalCount(
  startMin: number,
  endMin: number,
  slotDurationMinutes: number,
  minIntervals = 1
): number {
  const step = Math.max(1, slotDurationMinutes);
  const span = Math.max(0, endMin - startMin);
  return Math.max(minIntervals, Math.round(span / step));
}

export function rangesOverlapSameDay(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

export function eveningSegmentOverlaps(
  startMin: number,
  durationMin: number,
  ranges: Array<[number, number]>
): boolean {
  const segEnd = Math.min(MINUTES_PER_DAY, startMin + durationMin);
  return ranges.some(([s, e]) => rangesOverlapSameDay(startMin, segEnd, s, e));
}

export function storedEndTimeFromDuration(startMin: number, durationMin: number): string {
  return endTimeFromStartAndDuration(startMin, durationMin);
}

export function durationFromStoredTimes(startTime: string | null | undefined, endTime: string | null | undefined): number {
  return slotDurationMinutes(startTime, endTime);
}
