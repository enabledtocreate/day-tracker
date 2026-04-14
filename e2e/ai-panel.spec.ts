import { test, expect, type Page } from '@playwright/test';

const chatFixture = {
  schemaVersion: 1,
  kind: 'plan',
  advice: { summary: 'Fixture AI summary', bullets: ['One'] },
  dataRequests: [],
  proposedOrgCreates: [],
  proposals: [
    {
      id: 'p1',
      groupTitle: 'Fixture group',
      groupSummary: '',
      horizon: 'unspecified',
      prioritization: 'user_specified',
      cadence: { frequency: 'once', dayOfWeek: null, timeOfDay: null, notes: '' },
      tasks: [
        {
          title: 'Fixture proposed task',
          priority: 'medium',
          suggestedSlot: { date: null, start: null, end: null },
          groupWithTaskId: null,
          tagIds: [],
          tagTempIds: [],
          newTagSuggestions: [],
          categoryId: null,
          subcategoryId: null,
          categoryTempId: null,
          subcategoryTempId: null,
          linkAttachments: [],
        },
      ],
      questionsForUser: [],
    },
  ],
  clientHints: { includeIcalEvents: false, icalRangeDays: 7 },
};

/** Minimal API stubs so Next dev (no PHP) can render the logged-in shell. */
async function mockOfflinePhpShell(page: Page) {
  let loggedIn = false;

  await page.route('**/api/auth.php**', async (route) => {
    const url = route.request().url();
    if (url.includes('action=me')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          loggedIn
            ? {
                user: {
                  id: 1,
                  username: 'demo',
                  db_name: 'demo.sqlite',
                  is_admin: false,
                  sso: [],
                },
                ai_enabled: true,
              }
            : { user: null }
        ),
      });
      return;
    }
    if (url.includes('action=login') && route.request().method() === 'POST') {
      loggedIn = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
      return;
    }
    if (url.includes('action=logout') && route.request().method() === 'POST') {
      loggedIn = false;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      return;
    }
    await route.continue();
  });

  const json = (body: unknown) => ({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });

  await page.route('**/api/tasks.php**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill(json({ tasks: [] }));
      return;
    }
    await route.continue();
  });

  await page.route('**/api/settings.php**', async (route) => {
    await route.fulfill(
      json({
        start_hour: 8,
        end_hour: 18,
        increment_value: 30,
        increment_unit: 'min',
        timezone: '',
      })
    );
  });

  await page.route('**/api/day.php**', async (route) => {
    const u = new URL(route.request().url());
    const date = u.searchParams.get('date') || '2026-04-05';
    await route.fulfill(json({ id: 1, date }));
  });

  await page.route('**/api/slots.php**', async (route) => {
    const u = new URL(route.request().url());
    if (u.searchParams.has('from_date')) {
      await route.fulfill(json({ byDate: {} }));
      return;
    }
    await route.fulfill(json({ slots: [] }));
  });

  await page.route('**/api/accomplished.php**', async (route) => {
    const u = new URL(route.request().url());
    if (u.searchParams.has('summary_org')) {
      await route.fulfill(json({ days: [] }));
      return;
    }
    if (u.searchParams.has('list_all')) {
      await route.fulfill(json({ byDate: {} }));
      return;
    }
    await route.fulfill(json({ accomplished: [] }));
  });

  await page.route('**/api/data_integrity.php**', async (route) => {
    await route.fulfill(json({ ok: true, fixed: {} }));
  });

  await page.route('**/api/organization.php**', async (route) => {
    await route.fulfill(json({ categories: [], subcategories: [], tags: [] }));
  });

  await page.route('**/api/ical_events.php**', async (route) => {
    await route.fulfill(json({ events: [] }));
  });

  await page.route('**/api/ical_subscriptions.php**', async (route) => {
    await route.fulfill(json({ subscriptions: [] }));
  });

  await page.route('**/api/user.php**', async (route) => {
    await route.fulfill(
      json({
        user: { id: 1, username: 'demo', db_name: 'demo.sqlite', is_admin: false, sso: [] },
      })
    );
  });

  await page.route('**/api/ai/threads.php**', async (route) => {
    const req = route.request();
    const method = req.method();
    const url = req.url();
    if (method === 'GET' && !url.includes('id=')) {
      await route.fulfill(json({ threads: [{ id: 1, created_at: '2026-01-01', updated_at: '2026-01-01', title: null }] }));
      return;
    }
    if (method === 'GET' && url.includes('id=')) {
      const m = url.match(/id=(\d+)/);
      const id = m ? parseInt(m[1], 10) : 1;
      await route.fulfill(
        json({
          thread: { id, created_at: '2026-01-01', updated_at: '2026-01-01', title: null },
          messages: [],
        })
      );
      return;
    }
    if (method === 'POST') {
      const body = (req.postDataJSON() as { action?: string } | null) ?? {};
      if (body.action === 'create') {
        await route.fulfill(json({ thread: { id: 99, created_at: '2026-01-01', updated_at: '2026-01-01', title: null } }));
        return;
      }
      await route.fulfill(json({ message: { id: 1, thread_id: 1, role: 'user' } }));
      return;
    }
    if (method === 'DELETE') {
      await route.fulfill(json({ ok: true, deleted: 1 }));
      return;
    }
    await route.continue();
  });
}

test.describe('AI panel', () => {
  test('mocked chat shows summary and apply for list-only proposal', async ({ page }) => {
    await mockOfflinePhpShell(page);

    await page.route('**/api/chat.php**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(chatFixture),
      });
    });

    await page.goto('/');
    await page.getByLabel(/username/i).first().fill('demo');
    await page.getByLabel(/password/i).first().fill('demo');
    await page.getByRole('button', { name: /log in/i }).click();
    await expect(page.locator('#main-panels')).toBeVisible({ timeout: 20000 });

    await page.getByRole('button', { name: /show ai/i }).click();
    await page.getByPlaceholder(/ask for advice/i).fill('fixture message');
    await page.getByRole('button', { name: /^send$/i }).click();

    await expect(page.getByText('Fixture AI summary')).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: /apply proposals/i })).toBeEnabled();
  });
});
