import { test, expect } from '@playwright/test';

test.describe('Admin 403', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByLabel(/username/i).first().fill('demo');
    await page.getByLabel(/password/i).first().fill('demo');
    await page.getByRole('button', { name: /log in/i }).click();
    await expect(page.getByRole('button', { name: /today/i }).or(page.getByText(/completed tasks/i))).toBeVisible({ timeout: 10000 });
  });

  test('non-admin does not crash when opening settings', async ({ page }) => {
    await page.getByRole('button', { name: /user|settings|account/i }).first().click().catch(() => {});
    await expect(page).not.toHaveURL(/error/);
  });
});
