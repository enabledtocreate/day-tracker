/** Elements inside a schedule block that must not start hold-drag or steal title-edit focus. */
export const SCHEDULE_BLOCK_HOLD_EXCLUDE =
  'button, a, input, textarea, select, .time-block-resize, .time-block-resize-top, .time-block-complete-rail, .time-block-complete-checkbox, .time-block-drag-to-list, .time-block-link-inline, .time-block-link, .time-block-title, .time-block-title-line, .time-block-title-wrap, .time-block-edit, .schedule-untimed-title, .schedule-untimed-title-input, .time-block-group-boundary, .time-block-group-split-icon-btn, .time-block-header, .time-block-mobile-drawer, .time-block-actions-drawer, .time-block-drawer-chevron';

export function isScheduleBlockHoldExcluded(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest(SCHEDULE_BLOCK_HOLD_EXCLUDE);
}

/** Ignore blur fired immediately after opening inline title edit (double-click / drawer). */
export const SCHEDULE_TITLE_EDIT_BLUR_GUARD_MS = 250;

export function shouldIgnoreScheduleTitleBlur(openedAtMs: number, nowMs = performance.now()): boolean {
  return nowMs - openedAtMs < SCHEDULE_TITLE_EDIT_BLUR_GUARD_MS;
}
