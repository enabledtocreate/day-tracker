import { test, expect } from '@playwright/test';

test.describe('Schedule', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByLabel(/username/i).first().fill('demo');
    await page.getByLabel(/password/i).first().fill('demo');
    await page.getByRole('button', { name: /log in/i }).click();
    await expect(page.getByRole('button', { name: /today/i })).toBeVisible({ timeout: 10000 });
  });

  test('schedule has Today and Calendar tabs', async ({ page }) => {
    await expect(page.getByRole('button', { name: /today/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /calendar/i })).toBeVisible();
  });
});
