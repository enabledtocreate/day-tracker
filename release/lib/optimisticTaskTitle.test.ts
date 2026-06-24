import { describe, expect, it } from 'vitest';
import {
  patchCalendarSlotsByDateForTask,
  patchSlotTitlesForTask,
  patchTaskTitles,
} from '@/lib/optimisticTaskTitle';
import type { ScheduledSlot, Task } from '@/lib/api';

describe('optimisticTaskTitle', () => {
  const tasks: Task[] = [
    { id: 1, title: 'A', priority: 'low', recurring: false, parent_id: null, created_at: '' },
    { id: 2, title: 'B', priority: 'low', recurring: false, parent_id: null, created_at: '' },
  ];

  const slots: ScheduledSlot[] = [
    {
      id: 10,
      day_record_id: 1,
      task_id: 1,
      start_time: '09:00',
      end_time: '10:00',
      completed: 0,
      order_index: 0,
      title: 'A',
    },
    {
      id: 11,
      day_record_id: 1,
      task_id: 2,
      start_time: '10:00',
      end_time: '11:00',
      completed: 0,
      order_index: 0,
      title: 'B',
    },
  ];

  it('patches task and slot titles together', () => {
    expect(patchTaskTitles(tasks, 1, 'Renamed')[0]?.title).toBe('Renamed');
    expect(patchSlotTitlesForTask(slots, 1, 'Renamed')[0]?.title).toBe('Renamed');
    expect(patchSlotTitlesForTask(slots, 1, 'Renamed')[1]?.title).toBe('B');
    const byDate = patchCalendarSlotsByDateForTask({ '2026-06-03': slots }, 1, 'Renamed');
    expect(byDate['2026-06-03']?.[0]?.title).toBe('Renamed');
  });
});
