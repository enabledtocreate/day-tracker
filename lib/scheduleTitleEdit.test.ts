import { describe, expect, it } from 'vitest';
import {
  isScheduleBlockHoldExcluded,
  shouldIgnoreScheduleTitleBlur,
  SCHEDULE_TITLE_EDIT_BLUR_GUARD_MS,
} from '@/lib/scheduleTitleEdit';

describe('scheduleTitleEdit', () => {
  it('treats title line and edit input as hold excluded', () => {
    document.body.innerHTML = `
      <div class="time-block">
        <div class="time-block-title-line">
          <div class="time-block-title">Task</div>
        </div>
        <input class="time-block-edit" />
      </div>
    `;
    const titleLine = document.querySelector('.time-block-title-line')!;
    const title = document.querySelector('.time-block-title')!;
    const input = document.querySelector('.time-block-edit')!;
    expect(isScheduleBlockHoldExcluded(titleLine)).toBe(true);
    expect(isScheduleBlockHoldExcluded(title)).toBe(true);
    expect(isScheduleBlockHoldExcluded(input)).toBe(true);
    expect(isScheduleBlockHoldExcluded(document.querySelector('.time-block')!)).toBe(false);
  });

  it('ignores blur immediately after opening edit', () => {
    const openedAt = 1000;
    expect(shouldIgnoreScheduleTitleBlur(openedAt, openedAt + SCHEDULE_TITLE_EDIT_BLUR_GUARD_MS - 1)).toBe(true);
    expect(shouldIgnoreScheduleTitleBlur(openedAt, openedAt + SCHEDULE_TITLE_EDIT_BLUR_GUARD_MS)).toBe(false);
  });
});
