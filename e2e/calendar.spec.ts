import { test, expect } from '@playwright/test';

test.describe('Calendar view', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByLabel(/username/i).fill('demo');
    await page.getByLabel(/password/i).first().fill('demo');
    await page.getByRole('button', { name: /log in/i }).click();
    await expect(page.getByRole('button', { name: /calendar/i })).toBeVisible({ timeout: 10000 });
  });

  test('switching to Calendar tab shows calendar', async ({ page }) => {
    await page.getByRole('button', { name: /calendar/i }).click();
    await expect(page.getByRole('button', { name: /calendar/i })).toHaveClass(/active/);
  });
});
