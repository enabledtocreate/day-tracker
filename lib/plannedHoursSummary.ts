import type { ScheduledSlot, ScheduleBlock, Task } from '@/lib/api';
import { timedSlotLayoutBounds } from '@/lib/timedSlotLayout';
import { slotDurationMinutes } from '@/lib/overnightSlotTimes';

export type PlannedSummaryTask = {
  task_id: number;
  title: string;
  hours: number;
  completed: boolean;
};

export type PlannedSummaryRow = {
  category: string;
  subcategory: string | null;
  hours: number;
  tasks: PlannedSummaryTask[];
};

export type PlannedBlockRow = {
  block_name: string;
  hours: number;
};

export type PlannedHoursSummary = {
  categoryRows: PlannedSummaryRow[];
  categoryTotalHours: number;
  blockRows: PlannedBlockRow[];
  blockTotalHours: number;
};

/** Duration in hours from HH:MM slot times (matches accomplished rollup). */
export function slotHoursFromTimes(start?: string | null, end?: string | null): number {
  if (!start || !end) return 0;
  const parse = (t: string): number => {
    const parts = t.split(':').map(Number);
    return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
  };
  const dm = parse(end) - parse(start);
  if (dm <= 0) return 0;
  return Math.round((dm / 60) * 100) / 100;
}

function rootSlotsForSet(slots: ScheduledSlot[]): ScheduledSlot[] {
  return slots.filter((s) => !s.parent_id || !slots.some((o) => o.task_id === s.parent_id));
}

function childSlotsForParent(slots: ScheduledSlot[], parentTaskId: number): ScheduledSlot[] {
  return slots.filter((c) => c.parent_id === parentTaskId);
}

export function taskExcludedFromPlannedHours(task: Task | undefined): boolean {
  if (!task) return false;
  return Number(task.exclude_from_planned_hours) === 1 || task.exclude_from_planned_hours === true;
}

export function computePlannedCategorySummary(
  slots: ScheduledSlot[],
  tasks: Task[],
  categories: Array<{ id: number; name: string }>,
  subcategories: Array<{ id: number; category_id: number; name: string }>
): { rows: PlannedSummaryRow[]; totalHours: number } {
  const tasksById = new Map(tasks.map((t) => [t.id, t]));
  const catById = new Map(categories.map((c) => [c.id, c.name]));
  const subById = new Map(subcategories.map((s) => [s.id, s]));

  type Bucket = { hours: number; tasks: Map<number, PlannedSummaryTask> };
  const buckets = new Map<string, Bucket>();

  for (const slot of rootSlotsForSet(slots)) {
    if (!slot.start_time || !slot.end_time) continue;
    const children = childSlotsForParent(slots, slot.task_id);
    const durationMin =
      children.length > 0
        ? timedSlotLayoutBounds(slot, children).endMin - timedSlotLayoutBounds(slot, children).startMin
        : slotDurationMinutes(slot.start_time, slot.end_time);
    const hours = Math.round((durationMin / 60) * 100) / 100;
    if (hours <= 0) continue;

    const task = tasksById.get(slot.task_id);
    if (taskExcludedFromPlannedHours(task)) continue;

    const catName =
      task?.category_id != null ? (catById.get(task.category_id) ?? '(Uncategorized)') : '(Uncategorized)';
    const subRaw = task?.subcategory_id != null ? subById.get(task.subcategory_id) : undefined;
    const subName = subRaw?.name ?? null;
    const key = `${catName}\0${subName ?? ''}`;

    if (!buckets.has(key)) {
      buckets.set(key, { hours: 0, tasks: new Map() });
    }
    const bucket = buckets.get(key)!;
    bucket.hours = Math.round((bucket.hours + hours) * 100) / 100;

    const title = (slot.title ?? task?.title ?? 'Task').trim() || 'Task';
    const completed = Number(slot.completed) === 1;
    const existing = bucket.tasks.get(slot.task_id);
    if (existing) {
      existing.hours = Math.round((existing.hours + hours) * 100) / 100;
      existing.completed = existing.completed && completed;
    } else {
      bucket.tasks.set(slot.task_id, {
        task_id: slot.task_id,
        title,
        hours,
        completed,
      });
    }
  }

  const rows: PlannedSummaryRow[] = [];
  let totalHours = 0;
  for (const [key, bucket] of buckets) {
    const [category, sub] = key.split('\0');
    const taskList = Array.from(bucket.tasks.values()).sort((a, b) => a.title.localeCompare(b.title));
    rows.push({
      category,
      subcategory: sub !== '' ? sub : null,
      hours: bucket.hours,
      tasks: taskList,
    });
    totalHours += bucket.hours;
  }
  rows.sort((a, b) => {
    const c = a.category.localeCompare(b.category);
    if (c !== 0) return c;
    return (a.subcategory ?? '').localeCompare(b.subcategory ?? '');
  });
  totalHours = Math.round(totalHours * 100) / 100;
  return { rows, totalHours };
}

export function computePlannedBlockSummary(
  blocks: Array<Pick<ScheduleBlock, 'start_time' | 'end_time'> & { block_name?: string | null }>
): { rows: PlannedBlockRow[]; totalHours: number } {
  const byName = new Map<string, number>();
  for (const b of blocks) {
    const name = (b.block_name ?? '').trim() || '(Block)';
    const h = slotHoursFromTimes(b.start_time, b.end_time);
    if (h <= 0) continue;
    byName.set(name, Math.round(((byName.get(name) ?? 0) + h) * 100) / 100);
  }
  const rows = Array.from(byName.entries())
    .map(([block_name, hours]) => ({ block_name, hours }))
    .sort((a, b) => a.block_name.localeCompare(b.block_name));
  const totalHours = Math.round(rows.reduce((s, r) => s + r.hours, 0) * 100) / 100;
  return { rows, totalHours };
}

export function mergePlannedSummaries(
  category: { rows: PlannedSummaryRow[]; totalHours: number },
  blocks: { rows: PlannedBlockRow[]; totalHours: number }
): PlannedHoursSummary {
  return {
    categoryRows: category.rows,
    categoryTotalHours: category.totalHours,
    blockRows: blocks.rows,
    blockTotalHours: blocks.totalHours,
  };
}
