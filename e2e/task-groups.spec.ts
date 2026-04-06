import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test.describe('Task groups regression', () => {
  test.beforeEach(async ({ page }) => {
    // Ensure we run the desktop task list layout.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await page.getByLabel(/username/i).first().fill('demo');
    await page.getByLabel(/password/i).first().fill('demo');
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: /log in/i }).click();
    await expect(page.locator('#main-panels')).toBeVisible({ timeout: 20000 });

    // Ensure we are on the Task list view before interacting with task cards.
    const todayBtn = page.getByRole('button', { name: /today/i }).first();
    if ((await todayBtn.count()) > 0) {
      await todayBtn.click({ timeout: 2000 }).catch(() => {});
    }
  });

  test('task view: group priority applies to children', async ({ page }) => {
    const rootCard = page.locator('.task-card', { hasText: 'Project Alpha – design' }).first();
    await expect(rootCard).toBeVisible();

    const groupedRow = rootCard
      .locator('.task-card-group-segment')
      .filter({ hasText: /Design follow-up \(group example\)/i })
      .first();
    await expect(groupedRow).toBeVisible();

    // Set group root priority to "Low" and ensure grouped member button icon updates as well.
    const rootPriorityBtn = rootCard.locator('.priority-btn').first();
    await rootPriorityBtn.click();
    const picker = page.locator('.priority-picker[role="listbox"]').first();
    await expect(picker).toBeVisible();
    // Picker options may render as either <button> or role="option" depending on UI state.
    await picker
      .locator('button, [role="option"]')
      .filter({ hasText: /low/i })
      .first()
      .click();

    const childPriorityBtn = groupedRow.locator('button[title="Priority"]').first();
    await expect(rootPriorityBtn).toHaveText('↓');
    await expect(childPriorityBtn).toHaveText('↓');
  });

  test.skip('schedule view: scheduling a group root creates a stacked block with group height', async ({ page }) => {
    await page.getByRole('button', { name: /today/i }).first().click();

    const weeklyTitle = page.locator('#task-list-pending').getByText('Weekly planning', { exact: true }).first();
    await expect(weeklyTitle).toBeVisible();

    const weeklyCard = weeklyTitle.locator('xpath=ancestor::li[contains(@class,"task-card")]').first();
    await weeklyCard.locator('button[title="Schedule on a date"]').first().click();

    const modal = page.locator('dialog[aria-label="Schedule on date"]').first();
    await expect(modal).toBeVisible({ timeout: 20000 });
    await expect(modal.locator('h3')).toHaveText(/Schedule on date/i);

    const todayStr = new Date().toISOString().slice(0, 10);
    await modal.locator('input[type="date"]').fill(todayStr);

    // Ensure "No specific time" is off so we can verify height.
    const noTimeCheckbox = modal.getByLabel(/no specific time/i);
    if (await noTimeCheckbox.isChecked()) await noTimeCheckbox.uncheck();

    await modal.getByRole('button', { name: /^schedule$/i }).click();

    const timeBlockTitle = page.locator('.time-block-title', { hasText: 'Weekly planning' }).first();
    await expect(timeBlockTitle).toBeVisible({ timeout: 20000 });

    const timeBlock = page.locator('.time-block', { has: timeBlockTitle }).first();
    const box = await timeBlock.boundingBox();
    expect(box).not.toBeNull();

    // Weekly planning group has 3 members in demo seed => min group height ~= 3 * ROW_HEIGHT (32px) = 96px.
    expect(box!.height).toBeGreaterThan(80);
    expect(box!.height).toBeLessThan(110);
  });

  test.skip('mobile: completion checkbox style updates when pressed/completed', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    // Ensure the schedule panel's "Today" tab is active (avoid clicking the task list "Today" button).
    const scheduleTodayTab = page.locator('.schedule-tabs .schedule-tab', { hasText: /^Today$/ }).first();
    await scheduleTodayTab.click();

    // Wait for schedule content to render.
    await expect(page.locator('.time-view-container')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.time-block-title').first()).toBeVisible({ timeout: 20000 });

    // Group member rows are always visible under grouped time blocks.
    const checkBtn = page.locator('.time-block-children .time-block-check').first();
    await checkBtn.scrollIntoViewIfNeeded();
    await expect(checkBtn).toBeVisible({ timeout: 20000 });

    const ariaBefore = await checkBtn.getAttribute('aria-pressed');
    expect(ariaBefore === 'true' || ariaBefore === 'false').toBe(true);

    const colorBefore = await checkBtn.evaluate((el) => getComputedStyle(el).color);
    const isTransparent = /rgba\\(.*?,\\s*0\\)$/.test(colorBefore);
    if (ariaBefore === 'false') {
      expect(isTransparent).toBe(true);
    } else {
      expect(isTransparent).toBe(false);
    }

    await checkBtn.click();
    const ariaAfterExpected = ariaBefore === 'false' ? 'true' : 'false';
    await expect(checkBtn).toHaveAttribute('aria-pressed', ariaAfterExpected);

    const colorAfter = await checkBtn.evaluate((el) => getComputedStyle(el).color);
    const isTransparentAfter = /rgba\\(.*?,\\s*0\\)$/.test(colorAfter);
    if (ariaAfterExpected === 'false') {
      expect(isTransparentAfter).toBe(true);
    } else {
      expect(isTransparentAfter).toBe(false);
    }
  });
});

