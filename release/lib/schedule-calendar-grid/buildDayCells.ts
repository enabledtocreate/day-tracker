import type { IcalFeedEvent, ScheduledSlot, Task } from '@/lib/api';
import { buildCalendarDays } from '@/lib/schedule-calendar-grid/calendarLayout';
import {
  formatFeedEventTimeLabel,
  formatSlotTimeLabel,
  slotSortMinutes,
} from '@/lib/schedule-calendar-grid/formatCalendarTime';
import type { ScheduleCalendarDayCell } from '@/lib/schedule-calendar-grid/types';

function rootSlotsForDay(daySlots: ScheduledSlot[]): ScheduledSlot[] {
  return daySlots.filter((s) => !s.parent_id || !daySlots.some((o) => o.task_id === s.parent_id));
}

/** Lookup helpers used to attach category color to each cell row. */
export type CalendarCategoryLookup = {
  /** task_id → { category_id } */
  tasksById?: Map<number, Pick<Task, 'category_id'>>;
  /** category_id → { color } */
  categoriesById?: Map<number, { color?: string | null }>;
  /** App timezone for iCal feed time labels. */
  timezone?: string;
};

/**
 * Maps API schedule + feed data into a stable model for {@link ScheduleCalendarGrid} implementations.
 *
 * When `lookup` is provided, each task row receives a `categoryColor` derived
 * from its task's category — used to render a left-edge color stripe so users
 * can tell categories apart at a glance, even on dense mobile day cards.
 */
export function buildScheduleCalendarDayCells(
  monthAnchorYmd: string,
  slotsByDate: Record<string, ScheduledSlot[]>,
  feedByDate: Record<string, IcalFeedEvent[]>,
  todayYmd: string,
  lookup?: CalendarCategoryLookup
): ScheduleCalendarDayCell[] {
  const dayStrs = buildCalendarDays(monthAnchorYmd);
  const resolveColor = (taskId: number): string | null => {
    if (!lookup?.tasksById || !lookup?.categoriesById) return null;
    const t = lookup.tasksById.get(taskId);
    if (!t || t.category_id == null) return null;
    const cat = lookup.categoriesById.get(t.category_id);
    return cat?.color ?? null;
  };
  return dayStrs.map((dateStr, i) => {
    const daySlots = dateStr ? (slotsByDate[dateStr] ?? []) : [];
    const dayRoots = dateStr
      ? rootSlotsForDay(daySlots).slice().sort((a, b) => slotSortMinutes(a) - slotSortMinutes(b))
      : [];
    const dayFeed = dateStr ? (feedByDate[dateStr] ?? []) : [];
    const isPast = !!(dateStr && dateStr < todayYmd);
    const isTodayDate = dateStr === todayYmd;
    return {
      cellKey: `cal-${i}-${dateStr || 'pad'}`,
      dateStr: dateStr || null,
      dayOfMonthDisplay: dateStr ? String(new Date(dateStr + 'T00:00:00').getDate()) : '',
      isPast,
      isToday: isTodayDate,
      tasks: dayRoots.map((s) => ({
        id: s.id,
        title: s.title ?? 'Task',
        priority: s.priority || 'low',
        completed: !!s.completed,
        recurring: !!s.recurring,
        isRecurringOccurrence: !!s.is_recurring_occurrence,
        categoryColor: resolveColor(s.task_id),
        timeLabel: formatSlotTimeLabel(s),
      })),
      feedEvents: dayFeed.map((e) => ({
        listKey: e.uid + e.start,
        title: e.title || 'Event',
        timeLabel: formatFeedEventTimeLabel(e, lookup?.timezone),
      })),
    };
  });
}
