import { describe, expect, it } from 'vitest';
import {
  isScheduleBlockHoldExcluded,
  shouldIgnoreScheduleTitleBlur,
  SCHEDULE_TITLE_EDIT_BLUR_GUARD_MS,
} from '@/lib/scheduleTitleEdit';

describe('scheduleTitleEdit', () => {
  it('allows hold on title area but not on task-owned buttons/inputs', () => {
    document.body.innerHTML = `
      <div class="time-block">
        <div class="time-block-header">
          <div class="time-block-title-wrap">
            <div class="time-block-title-line">
              <div class="time-block-title">Task</div>
            </div>
          </div>
          <button type="button">Priority</button>
        </div>
        <input class="time-block-edit" />
      </div>
    `;
    const title = document.querySelector('.time-block-title')!;
    const titleLine = document.querySelector('.time-block-title-line')!;
    const header = document.querySelector('.time-block-header')!;
    const button = document.querySelector('button')!;
    const input = document.querySelector('.time-block-edit')!;
    expect(isScheduleBlockHoldExcluded(title)).toBe(false);
    expect(isScheduleBlockHoldExcluded(titleLine)).toBe(false);
    expect(isScheduleBlockHoldExcluded(header)).toBe(false);
    expect(isScheduleBlockHoldExcluded(button)).toBe(true);
    expect(isScheduleBlockHoldExcluded(input)).toBe(true);
    expect(isScheduleBlockHoldExcluded(document.querySelector('.time-block')!)).toBe(false);
  });

  it('ignores blur immediately after opening edit', () => {
    const openedAt = 1000;
    expect(shouldIgnoreScheduleTitleBlur(openedAt, openedAt + SCHEDULE_TITLE_EDIT_BLUR_GUARD_MS - 1)).toBe(true);
    expect(shouldIgnoreScheduleTitleBlur(openedAt, openedAt + SCHEDULE_TITLE_EDIT_BLUR_GUARD_MS)).toBe(false);
  });
});
