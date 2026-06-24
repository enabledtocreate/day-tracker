'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { ScheduleCalendarGridProps } from '@/lib/schedule-calendar-grid/types';

export function ScheduleCalendarGrid({ days, onDayClick, onDayDoubleClick, className }: ScheduleCalendarGridProps) {
  return (
    <div className={cn('calendar-view visible', className)}>
      <div className="calendar-grid grid grid-cols-7 gap-1 p-1">
        {days.map((cell) => {
          const { dateStr } = cell;
          if (!dateStr) {
            return (
              <div key={cell.cellKey} className="min-h-[5.5rem] rounded-md bg-muted/20" aria-hidden />
            );
          }
          return (
            <Card
              key={cell.cellKey}
              size="sm"
              data-date={dateStr}
              className={cn(
                'calendar-day min-h-[5.5rem] cursor-pointer gap-0 py-0 transition-shadow',
                cell.isPast && 'calendar-day-past opacity-75',
                cell.isToday && 'calendar-day-today ring-2 ring-primary'
              )}
              onClick={() => onDayClick(dateStr)}
              onDoubleClick={(e) => onDayDoubleClick(dateStr, e)}
            >
              <CardHeader className="calendar-day-header p-0 px-1.5 pt-1 pb-0">
                <CardTitle className="calendar-day-num text-xs font-medium leading-none">{cell.dayOfMonthDisplay}</CardTitle>
              </CardHeader>
              <CardContent className="calendar-day-body px-1.5 pb-1 pt-0.5">
                <ul className="calendar-day-tasks m-0 list-none space-y-0 p-0">
                  {cell.tasks.map((s) => (
                    <li
                      key={s.id}
                      className={cn(
                        'calendar-day-task flex min-w-0 gap-0.5 text-xs',
                        'calendar-day-task-priority-' + (s.priority || 'low'),
                        s.completed && 'calendar-day-task-completed',
                        s.isRecurringOccurrence && 'calendar-day-task-recurring'
                      )}
                    >
                      <span className="calendar-task-icon shrink-0" aria-hidden>
                        {s.completed ? '☑' : s.recurring || s.isRecurringOccurrence ? '↻' : '☐'}
                      </span>
                      {s.timeLabel ? (
                        <span className="calendar-task-time shrink-0" title={s.timeLabel}>
                          {s.timeLabel}
                        </span>
                      ) : null}
                      <span className="calendar-task-desc min-w-0 truncate">{s.title}</span>
                    </li>
                  ))}
                  {cell.feedEvents.map((e) => (
                    <li key={e.listKey} className="calendar-day-task calendar-day-feed-event flex min-w-0 gap-0.5 text-xs">
                      <span className="calendar-task-icon shrink-0" aria-hidden>
                        ◐
                      </span>
                      {e.timeLabel ? (
                        <span className="calendar-task-time shrink-0" title={e.timeLabel}>
                          {e.timeLabel}
                        </span>
                      ) : null}
                      <span className="calendar-task-desc min-w-0 truncate">{e.title}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
