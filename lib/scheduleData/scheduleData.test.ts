import { describe, it, expect } from 'vitest';
import { scheduleKeys } from '@/lib/scheduleData/keys';
import { buildWeekDates, getMonthRange } from '@/lib/scheduleDateUtils';

describe('scheduleKeys', () => {
  it('builds stable hierarchical keys', () => {
    expect(scheduleKeys.core()).toEqual(['schedule', 'core']);
    expect(scheduleKeys.day('2026-06-03')).toEqual(['schedule', 'day', '2026-06-03']);
    expect(scheduleKeys.week('2026-06-01', '7-day')).toEqual(['schedule', 'week', '2026-06-01', '7-day']);
    expect(scheduleKeys.month('2026-06-01', '2026-06-30')).toEqual([
      'schedule',
      'month',
      '2026-06-01',
      '2026-06-30',
    ]);
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
