import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Accessibility', () => {
  test('main app view has no critical a11y violations', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel(/username/i).first().fill('demo');
    await page.getByLabel(/password/i).first().fill('demo');
    await page.getByRole('button', { name: /log in/i }).click();
    await expect(page.getByRole('button', { name: /today/i }).or(page.getByRole('button', { name: /calendar/i }))).toBeVisible({ timeout: 10000 });

    const results = await new AxeBuilder({ page })
      .include('#main-panels')
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    const violations = results.violations;
    if (violations.length > 0) {
      const summary = violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`).join('; ');
      expect(violations, `A11y violations: ${summary}`).toHaveLength(0);
    }
  });
});
