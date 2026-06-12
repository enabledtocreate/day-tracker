'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ScheduleCalendarNavProps } from '@/lib/schedule-calendar-grid/types';

export function ScheduleCalendarNav({ monthLabel, onPrevMonth, onNextMonth }: ScheduleCalendarNavProps) {
  return (
    <div className={cn('schedule-header-day-row calendar-month-nav-header flex items-center gap-2')}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="calendar-month-prev"
        onClick={onPrevMonth}
        title="Previous month"
        aria-label="Previous month"
      >
        <ChevronLeft size={16} aria-hidden strokeWidth={2} />
      </Button>
      <span className="calendar-month-label min-w-[10rem] text-center text-sm text-muted-foreground">{monthLabel}</span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="calendar-month-next"
        onClick={onNextMonth}
        title="Next month"
        aria-label="Next month"
      >
        <ChevronRight size={16} aria-hidden strokeWidth={2} />
      </Button>
    </div>
  );
}
