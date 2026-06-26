import { describe, it, expect } from 'vitest';
import { scheduleKeys } from '@/lib/scheduleData/keys';
import { buildWeekDates, getMonthRange } from '@/lib/scheduleDateUtils';

describe('scheduleKeys', () => {
  const userId = 42;

  it('builds stable hierarchical keys scoped by user', () => {
    expect(scheduleKeys.core(userId)).toEqual(['schedule', userId, 'core']);
    expect(scheduleKeys.day(userId, '2026-06-03')).toEqual(['schedule', userId, 'day', '2026-06-03']);
    expect(scheduleKeys.week(userId, '2026-06-01', '7-day')).toEqual([
      'schedule',
      userId,
      'week',
      '2026-06-01',
      '7-day',
    ]);
    expect(scheduleKeys.month(userId, '2026-06-01', '2026-06-30')).toEqual([
      'schedule',
      userId,
      'month',
      '2026-06-01',
      '2026-06-30',
    ]);
  });

  it('isolates keys between accounts', () => {
    expect(scheduleKeys.core(1)).not.toEqual(scheduleKeys.core(2));
  });
});

describe('scheduleDateUtils', () => {
  it('getMonthRange returns first and last day of month', () => {
    expect(getMonthRange('2026-06-15')).toEqual({ from: '2026-06-01', to: '2026-06-30' });
  });

  it('buildWeekDates returns 7 days from Sunday anchor', () => {
    const dates = buildWeekDates('2026-06-01', '7-day');
    expect(dates).toHaveLength(7);
    expect(dates[0]).toBe('2026-06-01');
    expect(dates[6]).toBe('2026-06-07');
  });
});
