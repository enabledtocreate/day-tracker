import { describe, it, expect } from 'vitest';
import {
  formatCalendarClock12h,
  formatSlotTimeLabel,
  slotSortMinutes,
} from './formatCalendarTime';
import type { ScheduledSlot } from '@/lib/api';

describe('formatCalendarTime', () => {
  it('formats 24h clock to 12h', () => {
    expect(formatCalendarClock12h('09:00')).toBe('9:00 AM');
    expect(formatCalendarClock12h('13:30')).toBe('1:30 PM');
    expect(formatCalendarClock12h('00:15')).toBe('12:15 AM');
  });

  it('builds slot time range label', () => {
    const slot = {
      start_time: '09:00',
      end_time: '10:30',
    } as ScheduledSlot;
    expect(formatSlotTimeLabel(slot)).toBe('9:00 AM – 10:30 AM');
  });

  it('returns null for untimed slots', () => {
    expect(formatSlotTimeLabel({ start_time: null, end_time: null } as ScheduledSlot)).toBeNull();
  });

  it('sorts timed before untimed', () => {
    const timed = slotSortMinutes({ start_time: '10:00' } as ScheduledSlot);
    const untimed = slotSortMinutes({ start_time: null } as ScheduledSlot);
    expect(timed).toBeLessThan(untimed);
  });
});
