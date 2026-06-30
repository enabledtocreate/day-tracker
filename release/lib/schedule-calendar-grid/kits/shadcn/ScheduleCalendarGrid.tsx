'use client';

import { useRef } from 'react';
import { cn } from '@/lib/utils';
import type { ScheduleCalendarGridProps } from '@/lib/schedule-calendar-grid/types';
import { useCalendarDayWheelScroll } from '@/lib/schedule-calendar-grid/useCalendarDayWheelScroll';

export function ScheduleCalendarGrid({ days, onDayClick, onDayDoubleClick, className }: ScheduleCalendarGridProps) {
  const viewRef = useRef<HTMLDivElement>(null);
  useCalendarDayWheelScroll(viewRef);

  return (
    <div ref={viewRef} className={cn('calendar-view visible', className)}>
      <div className="calendar-grid">
        {days.map((cell) => {
          const { dateStr } = cell;
          if (!dateStr) {
            return <div key={cell.cellKey} className="calendar-day calendar-day-empty" aria-hidden />;
          }
          return (
            <div
              key={cell.cellKey}
              className={cn(
                'calendar-day',
                cell.isPast && 'calendar-day-past',
                cell.isToday && 'calendar-day-today'
              )}
              data-date={dateStr}
              tabIndex={0}
              onClick={() => onDayClick(dateStr)}
              onDoubleClick={(e) => onDayDoubleClick(dateStr, e)}
            >
              <div className="calendar-day-num">{cell.dayOfMonthDisplay}</div>
              <ul className="calendar-day-tasks">
                {cell.tasks.map((s) => (
                  <li
                    key={s.id}
                    className={cn(
                      'calendar-day-task',
                      'calendar-day-task-priority-' + (s.priority || 'low'),
                      s.completed && 'calendar-day-task-completed',
                      s.isRecurringOccurrence && 'calendar-day-task-recurring'
                    )}
                  >
                    <span className="calendar-task-icon" aria-hidden>
                      {s.completed ? '☑' : s.recurring || s.isRecurringOccurrence ? '↻' : '☐'}
                    </span>
                    {s.timeLabel ? (
                      <span className="calendar-task-time" title={s.timeLabel}>
                        {s.timeLabel}
                      </span>
                    ) : (
                      <span className="calendar-task-time calendar-task-time--empty" aria-hidden />
                    )}
                    <span className="calendar-task-desc">{s.title}</span>
                  </li>
                ))}
                {cell.feedEvents.map((e) => (
                  <li key={e.listKey} className="calendar-day-task calendar-day-feed-event">
                    <span className="calendar-task-icon" aria-hidden>
                      ◐
                    </span>
                    {e.timeLabel ? (
                      <span className="calendar-task-time" title={e.timeLabel}>
                        {e.timeLabel}
                      </span>
                    ) : (
                      <span className="calendar-task-time calendar-task-time--empty" aria-hidden />
                    )}
                    <span className="calendar-task-desc">{e.title}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
