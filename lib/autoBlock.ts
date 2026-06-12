import type { ScheduledSlot, ScheduleBlock, Task } from '@/lib/api';
import type { PriorityDisplay } from '@/lib/priorityTheme';

export type AutoBlockSortMode = 'added_asc' | 'added_desc' | 'priority' | 'due_date';

function timeToMinutes(time: string | null | undefined): number {
  if (!time) return 0;
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function sortTasksForAutoBlock(tasks: Task[], mode: AutoBlockSortMode, priorityDisplay: PriorityDisplay): Task[] {
  const list = [...tasks];
  if (mode === 'added_asc') {
    return list.sort((a, b) => {
      const aDate = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bDate = b.created_at ? new Date(b.created_at).getTime() : 0;
      return aDate - bDate || a.id - b.id;
    });
  }
  if (mode === 'added_desc') {
    return list.sort((a, b) => {
      const aDate = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bDate = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bDate - aDate || b.id - a.id;
    });
  }
  if (mode === 'priority') {
    return list.sort((a, b) => {
      const cmp = priorityDisplay.priorityRank(a.priority) - priorityDisplay.priorityRank(b.priority);
      return cmp || a.id - b.id;
    });
  }
  // due_date: soonest first; tasks without due date last
  return list.sort((a, b) => {
    const aDue = a.due_date && /^\d{4}-\d{2}-\d{2}$/.test(a.due_date) ? a.due_date : null;
    const bDue = b.due_date && /^\d{4}-\d{2}-\d{2}$/.test(b.due_date) ? b.due_date : null;
    if (aDue && bDue) return aDue.localeCompare(bDue) || a.id - b.id;
    if (aDue && !bDue) return -1;
    if (!aDue && bDue) return 1;
    return a.id - b.id;
  });
}

export type AutoBlockPlacement = {
  task_id: number;
  start_time: string;
  end_time: string;
  block_instance_id: number;
};

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

function minutesToTimeStr(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function computeAutoBlockPlacements(opts: {
  tasks: Task[];
  scheduleBlocks: ScheduleBlock[];
  existingSlots: ScheduledSlot[];
  scheduledTaskIds: Set<number>;
  slotDurationMinutes: number;
  sortMode: AutoBlockSortMode;
  priorityDisplay: PriorityDisplay;
}): { placements: AutoBlockPlacement[]; skipped: number } {
  const eligible = opts.tasks.filter(
    (t) =>
      !t.is_common &&
      !t.parent_id &&
      t.default_block_id != null &&
      t.default_block_id > 0 &&
      !opts.scheduledTaskIds.has(t.id)
  );
  if (eligible.length === 0) return { placements: [], skipped: 0 };

  const sorted = sortTasksForAutoBlock(eligible, opts.sortMode, opts.priorityDisplay);
  const occupied: Array<[number, number]> = opts.existingSlots
    .filter((s) => s.start_time && s.end_time)
    .map((s) => [timeToMinutes(s.start_time!), timeToMinutes(s.end_time!)]);

  const blocksByType = new Map<number, ScheduleBlock[]>();
  for (const b of opts.scheduleBlocks) {
    const arr = blocksByType.get(b.block_id) ?? [];
    arr.push(b);
    blocksByType.set(b.block_id, arr);
  }
  for (const arr of blocksByType.values()) {
    arr.sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time));
  }

  const placements: AutoBlockPlacement[] = [];
  let skipped = 0;

  for (const task of sorted) {
    const blockTypeId = task.default_block_id!;
    const instances = blocksByType.get(blockTypeId) ?? [];
    if (instances.length === 0) {
      skipped++;
      continue;
    }
    const intervals = Math.max(1, task.default_duration_intervals ?? 1);
    const durationMin = intervals * opts.slotDurationMinutes;
    let placed = false;

    for (const inst of instances) {
      const blockStart = timeToMinutes(inst.start_time);
      const blockEnd = timeToMinutes(inst.end_time);
      let cursor = blockStart;

      while (cursor + durationMin <= blockEnd) {
        const slotEnd = cursor + durationMin;
        const overlaps = occupied.some(([s, e]) => rangesOverlap(cursor, slotEnd, s, e));
        if (!overlaps) {
          const start_time = minutesToTimeStr(cursor);
          const end_time = minutesToTimeStr(slotEnd);
          placements.push({
            task_id: task.id,
            start_time,
            end_time,
            block_instance_id: inst.id,
          });
          occupied.push([cursor, slotEnd]);
          placed = true;
          break;
        }
        cursor += opts.slotDurationMinutes;
      }
      if (placed) break;
    }
    if (!placed) skipped++;
  }

  return { placements, skipped };
}
