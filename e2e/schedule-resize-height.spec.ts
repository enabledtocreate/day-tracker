import { test, expect } from '@playwright/test';

/**
 * Regression: scheduled task bottom-resize must not change the time block height
 * between the last pointer-move (while still pressed) and after pointer-up + refetch.
 * Demo seed includes "Call with team" 11:00–11:30 today (solo timed block).
 *
 * Requires a BASE_URL where `api/auth.php` returns JSON (PHP backend), not HTML from Next alone.
 * If you only run `npm run dev:next` without PHP, this test is skipped after login shows a JSON parse error.
 */
test.describe('Schedule task resize — UI height', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.getByLabel(/username/i).first().fill('demo');
    await page.getByLabel(/password/i).first().fill('demo');
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: /log in/i }).click();

    const panels = page.locator('#main-panels');
    const authJsonError = page.getByText(/not valid JSON|Unexpected token/i).first();

    let outcome: 'panels' | 'error' | 'timeout' = 'timeout';
    try {
      await Promise.race([
        panels.waitFor({ state: 'visible', timeout: 20_000 }).then(() => {
          outcome = 'panels';
        }),
        authJsonError.waitFor({ state: 'visible', timeout: 20_000 }).then(() => {
          outcome = 'error';
        }),
      ]);
    } catch {
      outcome = 'timeout';
    }

    if (outcome === 'error') {
      test.skip(
        true,
        'Login API did not return JSON (HTML/404 from server). Run e2e with PHP API reachable from BASE_URL (see playwright.config webServer / README).'
      );
    }
    if (outcome !== 'panels') {
      test.skip(true, 'Timed out waiting for #main-panels after login (backend or network).');
    }
  });

  test('bottom resize: block height while dragging matches height after release', async ({ page }) => {
    await page.locator('.schedule-tabs .schedule-tab', { hasText: /^Today$/ }).first().click().catch(() => {});
    await expect(page.locator('.time-view-container').first()).toBeVisible({ timeout: 20_000 });

    const block = page
      .locator('.time-block:not(.time-block-feed)', {
        has: page.locator('.time-block-title', { hasText: /Call with team/i }),
      })
      .first();
    await block.scrollIntoViewIfNeeded();
    await expect(block).toBeVisible({ timeout: 20_000 });

    const handle = block.locator('.time-block-resize:not(.time-block-resize-top)').first();
    await expect(handle).toBeVisible();
    const hb = await handle.boundingBox();
    expect(hb).not.toBeNull();

    const startX = hb!.x + hb!.width / 2;
    const startY = hb!.y + hb!.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();

    // Two grid rows ≈ extending by two schedule increments (see SCHEDULE_SLOT_ROW_HEIGHT_PX).
    const ROW_HEIGHT = 34;
    const dragRows = 2;
    await page.mouse.move(startX, startY + ROW_HEIGHT * dragRows, { steps: 10 });
    await page.waitForTimeout(150);

    const heightWhileDragging = await block.evaluate((el) => Math.round(el.getBoundingClientRect().height));
    expect(heightWhileDragging).toBeGreaterThan(0);

    await page.mouse.up();

    await expect(async () => {
      const heightAfter = await block.evaluate((el) => Math.round(el.getBoundingClientRect().height));
      expect(Math.abs(heightAfter - heightWhileDragging)).toBeLessThanOrEqual(2);
    }).toPass({ intervals: [100, 200, 400], timeout: 20_000 });
  });
});
