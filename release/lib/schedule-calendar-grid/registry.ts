import { ScheduleCalendarGrid as DefaultGrid } from '@/lib/schedule-calendar-grid/kits/default/ScheduleCalendarGrid';
import { ScheduleCalendarNav as DefaultNav } from '@/lib/schedule-calendar-grid/kits/default/ScheduleCalendarNav';
import { ScheduleCalendarGrid as ShadcnGrid } from '@/lib/schedule-calendar-grid/kits/shadcn/ScheduleCalendarGrid';
import { ScheduleCalendarNav as ShadcnNav } from '@/lib/schedule-calendar-grid/kits/shadcn/ScheduleCalendarNav';
import type { ScheduleCalendarGridKitId } from '@/lib/schedule-calendar-grid/types';

function activeKitId(): ScheduleCalendarGridKitId {
  return process.env.NEXT_PUBLIC_SCHEDULE_CALENDAR_GRID_KIT === 'shadcn' ? 'shadcn' : 'default';
}

const nav = activeKitId() === 'shadcn' ? ShadcnNav : DefaultNav;
const grid = activeKitId() === 'shadcn' ? ShadcnGrid : DefaultGrid;

export const ScheduleCalendarNav = nav;
export const ScheduleCalendarGrid = grid;

export function getScheduleCalendarGridKitId(): ScheduleCalendarGridKitId {
  return activeKitId();
}
