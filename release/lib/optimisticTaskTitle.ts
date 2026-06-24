import type { Dispatch, SetStateAction } from 'react';
import type { ScheduledSlot, Task } from '@/lib/api';

export function patchTaskTitles<T extends { id: number; title: string }>(
  items: T[],
  taskId: number,
  title: string
): T[] {
  return items.map((item) => (item.id === taskId ? { ...item, title } : item));
}

export function patchSlotTitlesForTask(
  slots: ScheduledSlot[],
  taskId: number,
  title: string
): ScheduledSlot[] {
  return slots.map((slot) => (slot.task_id === taskId ? { ...slot, title } : slot));
}

export function patchCalendarSlotsByDateForTask(
  byDate: Record<string, ScheduledSlot[]>,
  taskId: number,
  title: string
): Record<string, ScheduledSlot[]> {
  const next: Record<string, ScheduledSlot[]> = {};
  for (const [date, slots] of Object.entries(byDate)) {
    next[date] = patchSlotTitlesForTask(slots, taskId, title);
  }
  return next;
}

export type TaskTitlePatchTargets = {
  setTasks: Dispatch<SetStateAction<Task[]>>;
  setCommonTasks: Dispatch<SetStateAction<Task[]>>;
  setSlots: Dispatch<SetStateAction<ScheduledSlot[]>>;
  setCalendarSlotsByDate: Dispatch<SetStateAction<Record<string, ScheduledSlot[]>>>;
};

export function applyTaskTitlePatch(
  targets: TaskTitlePatchTargets,
  taskId: number,
  title: string
): void {
  targets.setTasks((prev) => patchTaskTitles(prev, taskId, title));
  targets.setCommonTasks((prev) => patchTaskTitles(prev, taskId, title));
  targets.setSlots((prev) => patchSlotTitlesForTask(prev, taskId, title));
  targets.setCalendarSlotsByDate((prev) => patchCalendarSlotsByDateForTask(prev, taskId, title));
}
