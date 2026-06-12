'use client';

import type React from 'react';
import type { ScheduleCalendarGridProps } from '@/lib/schedule-calendar-grid/types';

export function ScheduleCalendarGrid({ days, onDayClick, onDayDoubleClick, className }: ScheduleCalendarGridProps) {
  return (
    <div className={'calendar-view visible' + (className ? ` ${className}` : '')}>
      <div className="calendar-grid">
        {days.map((cell) => {
          const { dateStr } = cell;
          return (
            <div
              key={cell.cellKey}
              className={
                'calendar-day' +
                (dateStr ? (cell.isPast ? ' calendar-day-past' : cell.isToday ? ' calendar-day-today' : '') : '')
              }
              data-date={dateStr || ''}
              onClick={() => {
                if (!dateStr) return;
                onDayClick(dateStr);
              }}
              onDoubleClick={(e) => {
                if (!dateStr) return;
                onDayDoubleClick(dateStr, e);
              }}
            >
              <div className="calendar-day-num">{cell.dayOfMonthDisplay}</div>
              {dateStr && (
                <ul className="calendar-day-tasks">
                  {cell.tasks.map((s) => (
                    <li
                      key={s.id}
                      className={
                        'calendar-day-task calendar-day-task-priority-' +
                        (s.priority || 'low') +
                        (s.completed ? ' calendar-day-task-completed' : '') +
                        (s.isRecurringOccurrence ? ' calendar-day-task-recurring' : '')
                      }
                      style={
                        s.categoryColor
                          ? ({ ['--cal-task-cat-color' as string]: s.categoryColor } as React.CSSProperties)
                          : undefined
                      }
                    >
                      <span
                        className="calendar-task-icon"
                        aria-hidden
                        title={s.completed ? 'Completed' : s.recurring || s.isRecurringOccurrence ? 'Recurring' : undefined}
                      >
                        {s.completed ? '☑' : s.recurring || s.isRecurringOccurrence ? '↻' : '☐'}
                      </span>
                      <span className="calendar-task-desc">{s.title}</span>
                    </li>
                  ))}
                  {cell.feedEvents.map((e) => (
                    <li key={e.listKey} className="calendar-day-task calendar-day-feed-event">
                      <span className="calendar-task-icon" aria-hidden>
                        ◐
                      </span>
                      <span className="calendar-task-desc">{e.title}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
