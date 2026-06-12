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
                'calendar-day min-h-[5.5rem] cursor-pointer gap-0 py-2 transition-shadow',
                cell.isPast && 'calendar-day-past opacity-75',
                cell.isToday && 'calendar-day-today ring-2 ring-primary'
              )}
              onClick={() => onDayClick(dateStr)}
              onDoubleClick={(e) => onDayDoubleClick(dateStr, e)}
            >
              <CardHeader className="p-2 pb-0">
                <CardTitle className="calendar-day-num text-sm font-medium">{cell.dayOfMonthDisplay}</CardTitle>
              </CardHeader>
              <CardContent className="px-2 pb-2 pt-0">
                <ul className="calendar-day-tasks m-0 list-none space-y-0.5 p-0">
                  {cell.tasks.map((s) => (
                    <li
                      key={s.id}
                      className={cn(
                        'calendar-day-task flex gap-1 text-xs',
                        'calendar-day-task-priority-' + (s.priority || 'low'),
                        s.completed && 'calendar-day-task-completed',
                        s.isRecurringOccurrence && 'calendar-day-task-recurring'
                      )}
                    >
                      <span className="calendar-task-icon shrink-0" aria-hidden>
                        {s.completed ? '☑' : s.recurring || s.isRecurringOccurrence ? '↻' : '☐'}
                      </span>
                      <span className="calendar-task-desc line-clamp-2">{s.title}</span>
                    </li>
                  ))}
                  {cell.feedEvents.map((e) => (
                    <li key={e.listKey} className="calendar-day-task calendar-day-feed-event flex gap-1 text-xs">
                      <span className="calendar-task-icon shrink-0" aria-hidden>
                        ◐
                      </span>
                      <span className="calendar-task-desc line-clamp-2">{e.title}</span>
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
