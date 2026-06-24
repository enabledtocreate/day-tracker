import type { Task } from '@/lib/api';

/** Stored intervals × schedule increment → minutes on the grid. */
export function taskDefaultDurationMinutes(
  task: Pick<Task, 'default_duration_intervals'> | null | undefined,
  slotDurationMinutes: number
): number {
  const step = Math.max(1, slotDurationMinutes);
  const intervals = Math.max(1, task?.default_duration_intervals ?? 1);
  return intervals * step;
}

export function durationMinutesToIntervals(minutes: number, slotDurationMinutes: number): number {
  const step = Math.max(1, slotDurationMinutes);
  const roundedMinutes = Math.max(step, Math.round(Math.max(step, minutes) / step) * step);
  return Math.max(1, Math.round(roundedMinutes / step));
}

export function durationIntervalsToMinutes(intervals: number, slotDurationMinutes: number): number {
  return taskDefaultDurationMinutes({ default_duration_intervals: intervals }, slotDurationMinutes);
}

/** Total timed span when placing a task (or group root) on the schedule. */
export function schedulePlacementSpanMinutes(params: {
  task: Pick<Task, 'default_duration_intervals'> | null | undefined;
  memberCount: number;
  slotDurationMinutes: number;
}): number {
  const step = Math.max(1, params.slotDurationMinutes);
  const members = Math.max(1, params.memberCount);
  const defaultMin = taskDefaultDurationMinutes(params.task, step);
  const minGroupMin = members * step;
  return Math.max(minGroupMin, defaultMin);
}
