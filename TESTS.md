# PHP tests (Day Tracker)

## Install PHP

You need PHP 8.0+ and Composer to run tests.

### Option A: Chocolatey (Windows, run PowerShell as Administrator)

```powershell
choco install php -y
choco install composer -y
```

Refresh your PATH (new terminal or `refreshenv`), then in the project root:

```bash
composer install
composer test
```

### Option B: Download PHP (Windows)

1. Download a PHP 8.x ZIP from https://windows.php.net/download/
2. Unzip to e.g. `C:\php`
3. Add `C:\php` to your system **PATH**
4. Download Composer from https://getcomposer.org/download/ and run the installer, or use:
   ```powershell
   php -r "copy('https://getcomposer.org/installer', 'composer-setup.php');"
   php composer-setup.php
   php -r "unlink('composer-setup.php');"
   ```
   Then use `php composer.phar` instead of `composer` below, or move `composer.phar` to a PATH location as `composer`.

### Option C: Scoop (Windows)

```powershell
scoop install php composer
```

### Option D: WSL (Windows Subsystem for Linux)

From WSL, install PHP and Composer, then run tests from the project directory:

```bash
sudo apt update && sudo apt install -y php-cli php-sqlite3 php-mbstring php-xml composer
cd "/mnt/c/Users/$(whoami)/Projects/Goals/Day Tracker"   # adjust path if needed
composer install
composer test
```

Or run only the Database (Phase 2) and Unit tests:

```bash
./vendor/bin/phpunit tests/Database tests/Unit
```

**Note:** The project expects PHP 8.0+ (PHPUnit 10 needs 8.1+). On Windows without PHP in PATH, use Option A/B/C or WSL (Option D).

## Run tests

From the project root:

```bash
composer install
composer test
```

Or directly:

```bash
./vendor/bin/phpunit
```

Tests live in `tests/` and use PHPUnit 10; config is `phpunit.xml.dist`.

---

## Frontend and E2E tests

### Vitest (component tests)

```bash
npm install
npm run test:run
```

Runs component tests in `components/**/*.test.tsx`. No backend required.

### Playwright E2E

- **Smoke (no backend):** `npm run test:e2e:smoke` — runs only the “login form visible” test. Passes with just `npm run dev:next`.
- **Full E2E:** `npm run test:e2e` — runs all E2E tests. **Requires the PHP API to be running** (e.g. PHP built-in server or your usual backend) so login and app flows work. Start the backend, then run Playwright; use `BASE_URL` if the app is not at `http://localhost:3000`.
