# Day Tracker

Single-page task prioritization app with a daily time view and ChatGPT-assisted priorities. Uses HTML, TypeScript, CSS, and PHP with SQLite.

## Roadmap

- **SSO login** — Single sign-on (planned).
- **AI Chat box** — In-app AI chat for priorities and suggestions (planned).
- **Mobile support** — Touch-friendly layout, swipe navigation, and schedule view (in progress).

**No npm on the server.** The app runs on PHP only. You deploy by uploading files (e.g. via SFTP).

## Deploy (no npm required)

The **release/** folder in this repo is ready to upload. It contains the built app and all PHP files. You do not run npm on the server.

1. **Upload** the **contents** of the **release/** folder to your server’s document root (e.g. via SFTP).

2. **Install** — In your browser, open `https://yoursite.com/install.php` once. It creates `data/`, the SQLite database, and `config.php`. Then delete `install.php`.

3. **Configure** — Set `openai_api_key` in `config.php` (re-upload the file or use your host’s file manager).

4. **Use the app** — Open your site’s URL. The index page loads with styles and the app.

## Rebuilding the release folder (optional)

If you change the frontend (TypeScript/CSS) and have Node.js locally, you can rebuild the deployable folder:

```bash
npm install
npm run deploy
```

That updates the **release/** folder. Commit the updated **release/** if you want to keep the repo in sync, then upload again.

## Local development

- `npm run dev` — Vite dev server (frontend only).
- `npm run build && php -S localhost:8000 router.php` — Full local test: build, then run PHP; visit `http://localhost:8000/install.php` once, then `http://localhost:8000/`.

## Debug

Use the “Debug date” input in the app to override today’s date for testing rollover and scheduling.
