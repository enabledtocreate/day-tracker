import { describe, it, expect } from 'vitest';
import {
  durationMinutesToIntervals,
  durationIntervalsToMinutes,
  schedulePlacementSpanMinutes,
  taskDefaultDurationMinutes,
} from './taskDefaultDuration';

describe('taskDefaultDuration', () => {
  it('defaults to one increment when unset', () => {
    expect(taskDefaultDurationMinutes(undefined, 15)).toBe(15);
    expect(taskDefaultDurationMinutes({}, 15)).toBe(15);
  });

  it('converts intervals to minutes', () => {
    expect(taskDefaultDurationMinutes({ default_duration_intervals: 4 }, 15)).toBe(60);
  });

  it('rounds minutes input to increment grid', () => {
    expect(durationMinutesToIntervals(60, 15)).toBe(4);
    expect(durationMinutesToIntervals(22, 15)).toBe(1);
    expect(durationMinutesToIntervals(8, 15)).toBe(1);
  });

  it('converts minutes display back to intervals', () => {
    expect(durationIntervalsToMinutes(4, 15)).toBe(60);
  });

  it('uses max of group minimum and task default for placement span', () => {
    expect(
      schedulePlacementSpanMinutes({
        task: { default_duration_intervals: 4 },
        memberCount: 1,
        slotDurationMinutes: 15,
      })
    ).toBe(60);
    expect(
      schedulePlacementSpanMinutes({
        task: { default_duration_intervals: 1 },
        memberCount: 3,
        slotDurationMinutes: 15,
      })
    ).toBe(45);
    expect(
      schedulePlacementSpanMinutes({
        task: { default_duration_intervals: 4 },
        memberCount: 2,
        slotDurationMinutes: 15,
      })
    ).toBe(60);
  });
});
