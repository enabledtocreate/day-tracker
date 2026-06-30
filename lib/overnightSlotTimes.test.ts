import { describe, it, expect } from 'vitest';
import {
  addDaysToYmd,
  collectScheduleDaySegments,
  endTimeFromStartAndDuration,
  latestStartMinForDuration,
  slotDurationMinutes,
  slotSpansNextDay,
} from './overnightSlotTimes';
import type { ScheduledSlot } from './api';

describe('slotSpansNextDay', () => {
  it('detects overnight when end is before start', () => {
    expect(slotSpansNextDay('22:00', '05:00')).toBe(true);
    expect(slotSpansNextDay('09:00', '10:00')).toBe(false);
  });
});

describe('slotDurationMinutes', () => {
  it('computes overnight duration', () => {
    expect(slotDurationMinutes('22:00', '05:00')).toBe(7 * 60);
  });
});

describe('endTimeFromStartAndDuration', () => {
  it('wraps end time past midnight', () => {
    expect(endTimeFromStartAndDuration(22 * 60, 7 * 60)).toBe('05:00');
  });
});

describe('latestStartMinForDuration', () => {
  it('allows late start when overnight is permitted', () => {
    const latest = latestStartMinForDuration(7 * 60, 6, 24, 15, true);
    expect(latest).toBeGreaterThanOrEqual(22 * 60);
  });
});

describe('collectScheduleDaySegments', () => {
  it('includes evening and next-day continuation segments', () => {
    const slot: ScheduledSlot = {
      id: 1,
      day_record_id: 10,
      task_id: 5,
      start_time: '22:00',
      end_time: '05:00',
      completed: 0,
      order_index: 0,
    };
    const byDate: Record<number, string> = { 10: '2026-06-02' };
    const evening = collectScheduleDaySegments({
      allSlots: [slot],
      slotDayByRecordId: byDate,
      viewDate: '2026-06-02',
      viewStartMinutes: 6 * 60,
      viewEndMinutes: 24 * 60,
    });
    expect(evening).toHaveLength(1);
    expect(evening[0]!.startMin).toBe(22 * 60);

    const morning = collectScheduleDaySegments({
      allSlots: [slot],
      slotDayByRecordId: byDate,
      viewDate: '2026-06-03',
      viewStartMinutes: 0,
      viewEndMinutes: 24 * 60,
    });
    expect(morning).toHaveLength(1);
    expect(morning[0]!.continuation).toBe(true);
    expect(morning[0]!.endMin).toBe(5 * 60);
  });

  it('addDaysToYmd steps calendar days', () => {
    expect(addDaysToYmd('2026-06-02', 1)).toBe('2026-06-03');
  });
});
