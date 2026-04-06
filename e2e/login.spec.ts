import { test, expect } from '@playwright/test';

test.describe('Login', () => {
  test('shows login form when not authenticated', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: /day tracker/i })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: /log in/i })).toBeVisible();
  });

  test('shows error on invalid credentials', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel(/username/i).first().fill('invaliduser');
    await page.getByLabel(/password/i).first().fill('wrongpassword');
    await page.getByRole('button', { name: /log in/i }).click();
    await expect(page.getByRole('paragraph').filter({ hasText: /failed|error|invalid|unauthorized/i })).toBeVisible({ timeout: 5000 });
  });

  test('after valid login shows main app', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel(/username/i).first().fill('demo');
    await page.getByLabel(/password/i).first().fill('demo');
    await page.getByRole('button', { name: /log in/i }).click();
    // `#main-panels` is hidden on the login screen and becomes visible after successful auth.
    await expect(page.locator('#main-panels')).toBeVisible({ timeout: 20000 });
  });
});
