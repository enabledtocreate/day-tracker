import { test, expect } from '@playwright/test';

test.describe('Completed tasks panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByLabel(/username/i).first().fill('demo');
    await page.getByLabel(/password/i).first().fill('demo');
    await page.getByRole('button', { name: /log in/i }).click();
    await expect(page.getByText(/completed tasks/i)).toBeVisible({ timeout: 10000 });
  });

  test('Completed Tasks panel can be opened', async ({ page }) => {
    await page.getByRole('button', { name: /completed tasks/i }).click();
    await expect(page.getByRole('heading', { name: /completed tasks/i })).toBeVisible();
  });
});
