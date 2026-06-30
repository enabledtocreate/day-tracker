/** Tint applied to timed schedule blocks from a category color (matches TaskListAndSchedule). */
export function scheduleBlockBgColor(categoryColor: string | null | undefined): string {
  if (!categoryColor) return 'rgba(220, 220, 220, 0.45)';
  return categoryColor.startsWith('hsl')
    ? categoryColor.replace(/\)$/, ', 0.25)').replace(/^hsl\(/, 'hsla(')
    : categoryColor + '40';
}

/** Read-only iCal blocks on the schedule grid (`globals.css` `.time-block-feed`). */
export const ICAL_FEED_BLOCK_BG = 'rgba(128, 128, 128, 0.18)';

/** Per-subscription schedule tint; falls back to {@link ICAL_FEED_BLOCK_BG}. */
export function icalFeedBlockBgColor(scheduleColor?: string | null): string {
  const c = scheduleColor?.trim();
  if (!c) return ICAL_FEED_BLOCK_BG;
  return scheduleBlockBgColor(c);
}

/** Suggested gray tints for iCal subscription schedule blocks. */
export const ICAL_SUBSCRIPTION_GRAY_SWATCHES: Array<{ label: string; value: string | null }> = [
  { label: 'Default', value: null },
  { label: 'Cool gray', value: 'hsl(210, 11%, 58%)' },
  { label: 'Neutral', value: 'hsl(0, 0%, 55%)' },
  { label: 'Warm gray', value: 'hsl(30, 6%, 52%)' },
  { label: 'Blue gray', value: 'hsl(220, 9%, 50%)' },
  { label: 'Green gray', value: 'hsl(150, 7%, 48%)' },
  { label: 'Purple gray', value: 'hsl(270, 8%, 54%)' },
];

/** Untimed row chips (tasks + feed events in the untimed zone). */
export const SCHEDULE_UNTIMED_CHIP_BG = 'rgba(128, 128, 128, 0.18)';
