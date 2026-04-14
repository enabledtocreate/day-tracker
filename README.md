# Day Tracker

## Summary

**Day Tracker** is a browser-based personal productivity app: **tasks** (with priorities, links, checklists, categories/tags, and task groups), **scheduling** across **Today**, **Week**, and **Calendar** views, **completed-work history** with a time-by-category summary, optional **Smart Planning** (AI-assisted proposals applied to tasks and slots), and **iCal** integration (inbound subscriptions and an outbound feed). The UI is a **Next.js 14** static export; the backend is **PHP** with **SQLite** (a shared master database for accounts and per-user databases for data).

**No Node.js is required on the server.** You only upload the built **`release/`** artifact plus PHP; Node is used on your machine (or CI) to produce that folder.

---

## Documentation

| Document | Purpose |
|----------|---------|
| [`docs/Application-Spec.md`](docs/Application-Spec.md) | Current behavior, UX hierarchy, architecture, folder layout |
| [`docs/Application-SRS.md`](docs/Application-SRS.md) | Requirements (“shall” statements) |
| [`docs/DATABASE.md`](docs/DATABASE.md) | Database files, tables, migrations |
| [`contracts/schema.dbml`](contracts/schema.dbml) | Schema contract (DBML) |
| [`docs/BACKLOG.md`](docs/BACKLOG.md) | Planned work and follow-ups |

---

## Tech stack

- **Frontend:** React 18, Next.js 14 (App Router), TypeScript, global CSS design tokens (`app/globals.css`)
- **Backend:** PHP 7.4+ with PDO SQLite (`api/*.php`, `lib/*.php`)
- **Storage:** SQLite — master DB + one DB per user; optional `*_ai.sqlite` for AI threads
- **Tooling:** Vitest, PHPUnit, Playwright (`npm test`, `npm run test:php`, `npm run test:e2e`)

---

## Deploy (production)

The server only needs **PHP** with the **PDO SQLite** extension and a writable **`data/`** directory (created by install). **Do not run `npm` on the server.**

### 1. Build the release folder (on your dev machine or CI)

```bash
npm install
npm run build
```

This runs `next build` (static export to `out/`) and `node scripts/pack-next.cjs`, which assembles **`release/`**: static assets, `api/`, `lib/`, migrations, `cron/`, `install.php`, `config.example.php`, and `.htaccess`.

### 2. Upload

Upload the **contents** of **`release/`** to your site’s document root (SFTP, rsync, or your host’s deploy pipeline).

### 3. First-time install

1. In a browser, open **`https://your-domain.example/install.php`** once.
2. Follow prompts: it creates **`data/`**, the master SQLite database, an admin user, and **`config.php`** (from `config.example.php`).
3. **Delete `install.php`** from the server after a successful install (security).

### 4. Configure

Edit **`config.php`** on the server (or merge keys your host provides):

- **`openai_api_key`** — Required for **Smart Planning** (`api/chat.php`). Leave empty to keep AI disabled unless you enable it only via DB flags.
- **OAuth** (`google_client_id`, `google_client_secret`, `outlook_*`, etc.) — Used if you expose SSO login; optional for password-only installs.

Global toggles (e.g. **`ai_enabled`**, iCal sync options) can also be adjusted via an **admin** account in the app or in the master DB, depending on your workflow.

### 5. Optional: background iCal sync

If you use inbound iCal subscriptions at scale, configure a **cron job** on the host to run PHP periodically, e.g.:

```text
php /path/to/site/cron/ical_sync_all_users.php
```

(Adjust path and PHP CLI to match your host.)

### 6. Demo account

A seeded **`demo` / `demo`** account exists for try-before-register flows; the demo database resets on a schedule. Do not rely on it for persistent data.

---

## Local development

**Requirements:** Node.js 18+ (for Next.js), PHP 7.4+ with `pdo_sqlite`, Composer optional (PHP tests use `vendor/` if present).

```bash
npm install
npm run dev:next
```

Opens the Next.js dev server (frontend). API calls expect a PHP backend; point `lib/api.ts` / env at your API base URL, or serve PHP locally.

**Full stack locally (example):**

```bash
npm run build
php -S localhost:8000 router.php
```

Visit `http://localhost:8000/install.php` once if needed, then the app root. The repo includes **`router.php`** for routing API requests during local PHP’s built-in server.

**Tests:**

```bash
npm run test:run      # Vitest
npm run test:php      # PHPUnit (requires php.ini / extensions)
npm run test:e2e      # Playwright
```

---

## Rebuilding after changes

Per project convention, after meaningful changes to `src/`, `app/`, `components/`, `lib/`, or PHP under `api/` / `lib/`, run:

```bash
npm run build
```

Commit updated **`release/`** only if your team tracks the deployable artifact in git; otherwise build in CI and deploy artifacts only.

---

## Security notes

- Remove **`install.php`** after installation.
- Keep **`config.php`** out of public repositories if it contains secrets (use `config.example.php` as a template).
- iCal feed URLs use unguessable tokens; regenerating invalidates old links.

---

## License / contributing

(Add your license and contribution guidelines here if applicable.)
