/** Tint applied to timed schedule blocks from a category color (matches TaskListAndSchedule). */
export function scheduleBlockBgColor(categoryColor: string | null | undefined): string {
  if (!categoryColor) return 'rgba(220, 220, 220, 0.45)';
  return categoryColor.startsWith('hsl')
    ? categoryColor.replace(/\)$/, ', 0.25)').replace(/^hsl\(/, 'hsla(')
    : categoryColor + '40';
}

/** Read-only iCal blocks on the schedule grid (`globals.css` `.time-block-feed`). */
export const ICAL_FEED_BLOCK_BG = 'rgba(128, 128, 128, 0.18)';

/** Untimed row chips (tasks + feed events in the untimed zone). */
export const SCHEDULE_UNTIMED_CHIP_BG = 'rgba(128, 128, 128, 0.18)';
