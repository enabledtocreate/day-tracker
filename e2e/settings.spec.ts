import { test, expect } from '@playwright/test';

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByLabel(/username/i).first().fill('demo');
    await page.getByLabel(/password/i).first().fill('demo');
    await page.getByRole('button', { name: /log in/i }).click();
    await expect(page.getByRole('button', { name: /today/i })).toBeVisible({ timeout: 10000 });
  });

  test('changing start hour updates schedule grid labels', async ({ page }) => {
    await page.getByRole('button', { name: /today/i }).click();
    await expect(page.locator('.time-view-labels')).toBeVisible({ timeout: 5000 });

    const startSelect = page.locator('.time-settings-top-right select').first();
    await startSelect.selectOption({ value: '8' });

    await expect(page.locator('.time-view-labels').getByText('8:00 AM')).toBeVisible({ timeout: 3000 });
  });

  test('schedule settings section shows buckets, priorities, and auto-priority', async ({ page }) => {
    await page.getByRole('button', { name: /user menu/i }).click();
    await page.getByRole('menuitem', { name: /settings/i }).click();
    await expect(page.getByRole('heading', { name: /user settings/i })).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: /schedule settings/i }).click();
    await expect(page.getByText('Task list buckets')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Priorities')).toBeVisible();
    await expect(page.getByText(/Auto-priority/i)).toBeVisible();
  });
});
