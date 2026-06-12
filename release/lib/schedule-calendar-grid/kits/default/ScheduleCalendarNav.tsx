'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ScheduleCalendarNavProps } from '@/lib/schedule-calendar-grid/types';

export function ScheduleCalendarNav({ monthLabel, onPrevMonth, onNextMonth }: ScheduleCalendarNavProps) {
  return (
    <div className="schedule-header-day-row calendar-month-nav-header" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
      <button
        type="button"
        className="day-nav-btn day-nav-btn--icon calendar-month-prev"
        onClick={onPrevMonth}
        title="Previous month"
        aria-label="Previous month"
      >
        <ChevronLeft size={16} aria-hidden strokeWidth={2} />
      </button>
      <span className="calendar-month-label" style={{ fontSize: '0.85rem' }}>
        {monthLabel}
      </span>
      <button
        type="button"
        className="day-nav-btn day-nav-btn--icon calendar-month-next"
        onClick={onNextMonth}
        title="Next month"
        aria-label="Next month"
      >
        <ChevronRight size={16} aria-hidden strokeWidth={2} />
      </button>
    </div>
  );
}
