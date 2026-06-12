import type { MouseEvent } from 'react';

export type ScheduleCalendarGridKitId = 'default' | 'shadcn';

export type CalendarGridTaskRow = {
  id: number;
  title: string;
  priority: string;
  completed: boolean;
  recurring: boolean;
  isRecurringOccurrence: boolean;
  /** Optional hex color from the task's category (used for a left accent stripe). */
  categoryColor?: string | null;
};

export type CalendarGridFeedRow = {
  listKey: string;
  title: string;
};

/** One cell in the month grid (padding cells use `dateStr: null`). */
export type ScheduleCalendarDayCell = {
  cellKey: string;
  dateStr: string | null;
  dayOfMonthDisplay: string;
  isPast: boolean;
  isToday: boolean;
  tasks: CalendarGridTaskRow[];
  feedEvents: CalendarGridFeedRow[];
};

export type ScheduleCalendarNavProps = {
  monthLabel: string;
  onPrevMonth: () => void;
  onNextMonth: () => void;
};

export type ScheduleCalendarGridProps = {
  days: ScheduleCalendarDayCell[];
  onDayClick: (dateStr: string) => void;
  onDayDoubleClick: (dateStr: string, event: MouseEvent<HTMLDivElement>) => void;
  className?: string;
};
