import { test, expect } from '@playwright/test';

test.describe('Task list sections', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByLabel(/username/i).fill('demo');
    await page.getByLabel(/password/i).first().fill('demo');
    await page.getByRole('button', { name: /log in/i }).click();
    await expect(page.getByRole('button', { name: 'Today' })).toBeVisible({ timeout: 10000 });
  });

  test('main app content is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Today' })).toBeVisible();
  });
});
