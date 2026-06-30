import { describe, it, expect } from 'vitest';
import {
  computePlannedBlockSummary,
  computePlannedCategorySummary,
  slotHoursFromTimes,
  taskExcludedFromPlannedHours,
} from './plannedHoursSummary';
import type { ScheduledSlot, Task } from './api';

describe('slotHoursFromTimes', () => {
  it('computes hours between two times', () => {
    expect(slotHoursFromTimes('09:00', '10:30')).toBe(1.5);
  });
});

describe('computePlannedCategorySummary', () => {
  it('includes incomplete and completed timed slots', () => {
    const slots: ScheduledSlot[] = [
      {
        id: 1,
        day_record_id: 1,
        task_id: 10,
        title: 'Done task',
        start_time: '09:00',
        end_time: '10:00',
        completed: 1,
        order_index: 0,
        parent_id: null,
      },
      {
        id: 2,
        day_record_id: 1,
        task_id: 11,
        title: 'Open task',
        start_time: '10:00',
        end_time: '11:00',
        completed: 0,
        order_index: 1,
        parent_id: null,
      },
    ];
    const tasks: Task[] = [
      { id: 10, title: 'Done task', priority: 'low', recurring: false, parent_id: null, created_at: '', category_id: 1 },
      { id: 11, title: 'Open task', priority: 'low', recurring: false, parent_id: null, created_at: '', category_id: 1 },
    ];
    const { rows, totalHours } = computePlannedCategorySummary(slots, tasks, [{ id: 1, name: 'Work' }], []);
    expect(totalHours).toBe(2);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tasks).toHaveLength(2);
  });

  it('skips tasks marked exclude_from_planned_hours', () => {
    const slots: ScheduledSlot[] = [
      {
        id: 1,
        day_record_id: 1,
        task_id: 10,
        title: 'Sleep',
        start_time: '23:00',
        end_time: '07:00',
        completed: 0,
        order_index: 0,
        parent_id: null,
      },
      {
        id: 2,
        day_record_id: 1,
        task_id: 11,
        title: 'Work',
        start_time: '09:00',
        end_time: '10:00',
        completed: 0,
        order_index: 1,
        parent_id: null,
      },
    ];
    const tasks: Task[] = [
      {
        id: 10,
        title: 'Sleep',
        priority: 'low',
        recurring: false,
        parent_id: null,
        created_at: '',
        category_id: 1,
        exclude_from_planned_hours: true,
      },
      {
        id: 11,
        title: 'Work',
        priority: 'low',
        recurring: false,
        parent_id: null,
        created_at: '',
        category_id: 1,
      },
    ];
    expect(taskExcludedFromPlannedHours(tasks[0])).toBe(true);
    const { totalHours } = computePlannedCategorySummary(slots, tasks, [{ id: 1, name: 'Work' }], []);
    expect(totalHours).toBe(1);
  });
});

describe('computePlannedBlockSummary', () => {
  it('aggregates block strip hours by name', () => {
    const { rows, totalHours } = computePlannedBlockSummary([
      { block_name: 'Focus', start_time: '09:00', end_time: '11:00' },
      { block_name: 'Focus', start_time: '13:00', end_time: '14:00' },
    ]);
    expect(totalHours).toBe(3);
    expect(rows[0]!.block_name).toBe('Focus');
    expect(rows[0]!.hours).toBe(3);
  });
});
