'use client';

import { useRef, type CSSProperties } from 'react';
import type { ScheduleCalendarGridProps } from '@/lib/schedule-calendar-grid/types';
import { useCalendarDayWheelScroll } from '@/lib/schedule-calendar-grid/useCalendarDayWheelScroll';

export function ScheduleCalendarGrid({ days, onDayClick, onDayDoubleClick, className }: ScheduleCalendarGridProps) {
  const viewRef = useRef<HTMLDivElement>(null);
  useCalendarDayWheelScroll(viewRef);

  return (
    <div ref={viewRef} className={'calendar-view visible' + (className ? ` ${className}` : '')}>
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
              tabIndex={dateStr ? 0 : undefined}
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
                          ? ({ ['--cal-task-cat-color' as string]: s.categoryColor } as CSSProperties)
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
                      <span className="calendar-task-icon shrink-0" aria-hidden>
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
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
