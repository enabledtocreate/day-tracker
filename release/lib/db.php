<?php
/**
 * SQLite DB helper. Master DB (users, app settings, SSO); user DB path from session.
 */
require_once __DIR__ . '/logger.php';

function getConfig(): array {
    if (getenv('DAYTRACKER_TEST') === '1') {
        $dataDir = getenv('DAYTRACKER_TEST_DATA_DIR');
        if ($dataDir === false || $dataDir === '') {
            throw new RuntimeException('DAYTRACKER_TEST_DATA_DIR must be set when running tests.');
        }
        return [
            'data_dir' => $dataDir,
            'master_db_path' => $dataDir . DIRECTORY_SEPARATOR . 'daytracker_master.sqlite',
        ];
    }
    $path = dirname(__DIR__) . '/config.php';
    if (!is_file($path)) {
        throw new RuntimeException('config.php not found. Run install.php first.');
    }
    $config = require $path;
    return is_array($config) ? $config : [];
}

function getDataDir(): string {
    $config = getConfig();
    return $config['data_dir'] ?? dirname(__DIR__) . '/data';
}

function getMasterDbPath(): string {
    $config = getConfig();
    return $config['master_db_path'] ?? getDataDir() . '/daytracker_master.sqlite';
}

/** Legacy: default user DB path (used by install before multi-user). */
function getDbPath(): string {
    $config = getConfig();
    return $config['db_path'] ?? getDataDir() . '/daytracker.sqlite';
}

function getMasterPdo(): PDO {
    static $pdo = null;
    static $cacheKey = null;
    $path = getMasterDbPath();
    if ($pdo !== null && $cacheKey !== $path) {
        $pdo = null;
    }
    if ($pdo !== null) {
        return $pdo;
    }
    $cacheKey = $path;
    $dir = dirname($path);
    if (!is_dir($dir)) {
        throw new RuntimeException('Data directory does not exist: ' . $dir);
    }
    $pdo = new PDO('sqlite:' . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    return $pdo;
}

/**
 * Current user's DB path. Requires getCurrentUser() from auth.php (session).
 */
function getCurrentUserDbPath(): string {
    if (!function_exists('getCurrentUser')) {
        throw new RuntimeException('Auth not loaded.');
    }
    $user = getCurrentUser();
    if (!$user) throw new RuntimeException('Not logged in.');
    return getDataDir() . '/' . $user['db_name'];
}

/**
 * Per-user AI thread database path: same directory as main user DB, stem + "_ai.sqlite"
 * (e.g. data/foo.sqlite -> data/foo_ai.sqlite).
 */
function getCurrentUserAiDbPath(): string {
    $main = getCurrentUserDbPath();
    $dir = dirname($main);
    $stem = pathinfo($main, PATHINFO_FILENAME);
    return $dir . DIRECTORY_SEPARATOR . $stem . '_ai.sqlite';
}

/**
 * PDO for the current user's AI threads DB (separate file from tasks). Creates file and runs migrations_ai on first use.
 * Cache is keyed by main user DB path so PHPUnit (new temp dir per test) gets a fresh connection.
 */
function getAiPdo(): PDO {
    static $pdo = null;
    static $cacheKey = null;
    $key = getCurrentUserDbPath();
    if ($pdo !== null && $cacheKey === $key) {
        return $pdo;
    }
    $cacheKey = $key;
    $pdo = null;
    $path = getCurrentUserAiDbPath();
    $dir = dirname($path);
    if (!is_dir($dir)) {
        throw new RuntimeException('Data directory does not exist: ' . $dir);
    }
    $pdo = new PDO('sqlite:' . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec('PRAGMA foreign_keys = ON');
    $migrationsDir = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'migrations_ai';
    runMigrationsIn($pdo, $migrationsDir);
    $chk = $pdo->query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ai_threads'");
    if (!$chk || !$chk->fetchColumn()) {
        throw new RuntimeException(
            'AI database has no ai_threads table. Deploy the migrations_ai folder next to lib/ (see migrations_ai/001_ai_threads.sql).'
        );
    }
    return $pdo;
}

function getAiPdoSafe(): PDO {
    try {
        return getAiPdo();
    } catch (Throwable $e) {
        logError('ERROR', 'AI database unavailable: ' . $e->getMessage(), [
            'file' => $e->getFile(),
            'line' => $e->getLine(),
            'trace' => $e->getTraceAsString(),
        ]);
        jsonError('AI database unavailable: ' . $e->getMessage(), 503);
        exit;
    }
}

function getPdo(): PDO {
    static $pdo = null;
    static $cacheKey = null;
    $path = getCurrentUserDbPath();
    if ($pdo !== null && $cacheKey !== $path) {
        $pdo = null;
    }
    if ($pdo !== null) {
        return $pdo;
    }
    $cacheKey = $path;
    $dir = dirname($path);
    if (!is_dir($dir)) {
        throw new RuntimeException('Data directory does not exist: ' . $dir);
    }
    if (!is_file($path)) {
        throw new RuntimeException('User database not found.');
    }
    $pdo = new PDO('sqlite:' . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    runMigrationsIn($pdo, dirname(__DIR__) . '/migrations');
    return $pdo;
}


/** Last list of migration filenames applied by runMigrationsIn (for migrate.php to return). */
function getLastAppliedMigrations(): array {
    return $GLOBALS['_daytracker_last_applied_migrations'] ?? [];
}

/** True when a migration statement can be skipped (partial apply / safe retry). */
function isSkippableMigrationError(string $message): bool {
    if (stripos($message, 'duplicate column name') !== false) {
        return true;
    }
    // e.g. "trigger sync_bump_tasks_ins already exists" after a partial 036 apply
    if (stripos($message, 'already exists') !== false && stripos($message, 'trigger') !== false) {
        return true;
    }
    return false;
}

function recordMigrationApplied(PDO $pdo, string $filename): void {
    $pdo->exec("INSERT OR IGNORE INTO schema_migrations (filename) VALUES (" . $pdo->quote($filename) . ")");
}

/**
 * Run pending migrations from a migrations folder.
 * Logs: "Begin migration", then one line per file run, then "migration completed".
 * Records each applied migration in schema_migrations.
 * @return list of filenames that were applied this run
 */
function runMigrationsIn(PDO $pdo, string $migrationsDir): array {
    $applied = [];
    $GLOBALS['_daytracker_last_applied_migrations'] = $applied;
    if (!is_dir($migrationsDir)) return $applied;
    logMessage('INFO', 'Begin migration');
    $pdo->exec("CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY)");
    $files = glob($migrationsDir . '/*.sql');
    sort($files);
    foreach ($files as $file) {
        $filename = basename($file);
        $stmt = $pdo->query("SELECT 1 FROM schema_migrations WHERE filename = " . $pdo->quote($filename));
        if ($stmt && $stmt->fetch()) continue;
        $sql = file_get_contents($file);
        if ($sql === false) throw new RuntimeException('Could not read migration: ' . $file);
        try {
            $pdo->exec($sql);
            logMessage('INFO', 'migration file: ' . $filename);
            $applied[] = $filename;
            recordMigrationApplied($pdo, $filename);
        } catch (Throwable $e) {
            if (isSkippableMigrationError($e->getMessage())) {
                recordMigrationApplied($pdo, $filename);
                logMessage('INFO', 'migration recorded (idempotent retry): ' . $filename, ['error' => $e->getMessage()]);
                $applied[] = $filename;
                continue;
            }
            throw $e;
        }
    }
    logMessage('INFO', 'migration completed');
    $GLOBALS['_daytracker_last_applied_migrations'] = $applied;
    return $applied;
}

/** Run user DB migrations (tasks, slots, etc.). */
function runMigrations(PDO $pdo = null): void {
    $pdo = $pdo ?? getPdo();
    runMigrationsIn($pdo, dirname(__DIR__) . '/migrations');
}

function ensureMigrationsTable(PDO $pdo): void {
    $pdo->exec("CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY)");
}

/** iCal feed fetch timeout in seconds (from app_settings). Default 60, clamped 5–300. */
function getIcalFetchTimeout(): int {
    try {
        $master = getMasterPdo();
        $stmt = $master->query("SELECT value FROM app_settings WHERE key = 'ical_fetch_timeout'");
        $row = $stmt ? $stmt->fetch(PDO::FETCH_ASSOC) : false;
        $v = $row ? (int) $row['value'] : 60;
        return max(5, min(300, $v));
    } catch (Throwable $e) {
        return 60;
    }
}

/** iCal fetch method: always curl if available, else fopen (no admin setting). */
function getIcalFetchMethod(): string {
    return function_exists('curl_init') ? 'curl' : 'fopen';
}

/**
 * Directory path for saving iCal fetch files. Always under app data dir (local path only).
 * Stored value is a relative subpath (e.g. "ical_fetches"); default "ical_fetches".
 */
function getIcalSaveFolder(): string {
    try {
        $dataDir = rtrim(str_replace(['/', '\\'], DIRECTORY_SEPARATOR, getDataDir()), DIRECTORY_SEPARATOR);
        $master = getMasterPdo();
        $stmt = $master->query("SELECT value FROM app_settings WHERE key = 'ical_save_folder'");
        $row = $stmt ? $stmt->fetch(PDO::FETCH_ASSOC) : false;
        $v = $row ? trim((string) $row['value']) : '';
        if ($v !== '' && strpos($v, '..') === false && $v[0] !== '/' && $v[0] !== '\\') {
            $sub = trim(preg_replace('#[/\\\\]+#', DIRECTORY_SEPARATOR, $v), DIRECTORY_SEPARATOR);
            if ($sub !== '') {
                $dir = $dataDir . DIRECTORY_SEPARATOR . $sub;
                if (!is_dir($dir)) {
                    @mkdir($dir, 0755, true);
                }
                $realDir = realpath($dir);
                $realData = realpath($dataDir);
                if ($realDir !== false && $realData !== false && strpos($realDir, $realData . DIRECTORY_SEPARATOR) === 0) {
                    return $realDir;
                }
            }
        }
        $dir = $dataDir . DIRECTORY_SEPARATOR . 'ical_fetches';
        if (!is_dir($dir)) {
            @mkdir($dir, 0755, true);
        }
        return $dir;
    } catch (Throwable $e) {
        logError('WARNING', 'getIcalSaveFolder fallback: ' . $e->getMessage(), [
            'file' => $e->getFile(),
            'line' => $e->getLine(),
        ]);
        $dir = getDataDir() . DIRECTORY_SEPARATOR . 'ical_fetches';
        if (!is_dir($dir)) {
            @mkdir($dir, 0755, true);
        }
        return $dir;
    }
}

/** Whether to keep the last-fetch file after parsing (for debugging). When false, file is deleted after parse. */
function getIcalSaveLastFetch(): bool {
    try {
        $master = getMasterPdo();
        $stmt = $master->query("SELECT value FROM app_settings WHERE key = 'ical_save_last_fetch'");
        $row = $stmt ? $stmt->fetch(PDO::FETCH_ASSOC) : false;
        return $row && $row['value'] === '1';
    } catch (Throwable $e) {
        return false;
    }
}

/** Minutes after last_synced_at before a subscription is considered stale. From app_settings ical_sync_stale_minutes; default 15. When server cron mode is on, uses ical_sync_interval_minutes so staleness matches the configured sync spacing. */
function getIcalSyncStaleMinutes(): int {
    try {
        if (getIcalUseCronJob()) {
            return getIcalSyncIntervalMinutes();
        }
        $master = getMasterPdo();
        $stmt = $master->query("SELECT value FROM app_settings WHERE key = 'ical_sync_stale_minutes'");
        $row = $stmt ? $stmt->fetch(PDO::FETCH_ASSOC) : false;
        $v = $row ? (int) $row['value'] : 15;
        return max(1, min(1440, $v));
    } catch (Throwable $e) {
        return 15;
    }
}

/** Days ahead from today to sync and show iCal events (schedule/calendar). From app_settings ical_event_range_days; default 365. */
function getIcalEventRangeDays(): int {
    try {
        $master = getMasterPdo();
        $stmt = $master->query("SELECT value FROM app_settings WHERE key = 'ical_event_range_days'");
        $row = $stmt ? $stmt->fetch(PDO::FETCH_ASSOC) : false;
        $v = $row ? (int) $row['value'] : 365;
        return max(1, min(366 * 2, $v));
    } catch (Throwable $e) {
        return 365;
    }
}

/**
 * iCal event UIDs to omit from API responses (hidden from schedule/calendar).
 * Stored in app_settings ical_omit_uids: newline- or comma-separated list. Flexible for future (e.g. patterns).
 * @return string[] List of UIDs to exclude (trimmed, non-empty).
 */
function getIcalOmitUids(): array {
    try {
        $master = getMasterPdo();
        $stmt = $master->query("SELECT value FROM app_settings WHERE key = 'ical_omit_uids'");
        $row = $stmt ? $stmt->fetch(PDO::FETCH_ASSOC) : false;
        $raw = $row ? trim((string) $row['value']) : '';
        if ($raw === '') {
            return [];
        }
        $uids = preg_split('/[\r\n,]+/', $raw, -1, PREG_SPLIT_NO_EMPTY);
        return array_values(array_filter(array_map('trim', $uids)));
    } catch (Throwable $e) {
        return [];
    }
}

/** Whether to run periodic iCal fetch on the Today tab (interval). When false, fetch only on page load/refresh. From app_settings ical_interval_fetch; default true. Off when subscribed calendars are disabled. */
function getIcalIntervalFetchEnabled(): bool {
    try {
        $master = getMasterPdo();
        $stmt = $master->query("SELECT value FROM app_settings WHERE key = 'ical_subscriptions_enabled'");
        $rowSub = $stmt ? $stmt->fetch(PDO::FETCH_ASSOC) : false;
        if ($rowSub && trim((string) ($rowSub['value'] ?? '')) === '0') {
            return false;
        }
        $stmt = $master->query("SELECT value FROM app_settings WHERE key = 'ical_interval_fetch'");
        $row = $stmt ? $stmt->fetch(PDO::FETCH_ASSOC) : false;
        $v = $row ? trim((string) $row['value']) : '1';
        return $v !== '0' && $v !== '';
    } catch (Throwable $e) {
        return true;
    }
}

/** How often (in minutes) to sync iCal when interval fetch is on. From app_settings ical_sync_interval_minutes; default 15. */
function getIcalSyncIntervalMinutes(): int {
    try {
        $master = getMasterPdo();
        $stmt = $master->query("SELECT value FROM app_settings WHERE key = 'ical_sync_interval_minutes'");
        $row = $stmt ? $stmt->fetch(PDO::FETCH_ASSOC) : false;
        $v = $row ? (int) $row['value'] : 15;
        return max(1, min(120, $v > 0 ? $v : 15));
    } catch (Throwable $e) {
        return 15;
    }
}

/**
 * When true, browsers skip trigger sync (sync_if_stale / interval); a server cron should call the sync pipeline for all users.
 * Stored in master app_settings as ical_use_cron_job ('1' / absent or '0').
 */
function getIcalUseCronJob(): bool {
    try {
        $master = getMasterPdo();
        $stmt = $master->query("SELECT value FROM app_settings WHERE key = 'ical_subscriptions_enabled'");
        $rowSub = $stmt ? $stmt->fetch(PDO::FETCH_ASSOC) : false;
        if ($rowSub && trim((string) ($rowSub['value'] ?? '')) === '0') {
            return false;
        }
        $stmt = $master->query("SELECT value FROM app_settings WHERE key = 'ical_use_cron_job'");
        $row = $stmt ? $stmt->fetch(PDO::FETCH_ASSOC) : false;
        return $row && trim((string) $row['value']) === '1';
    } catch (Throwable $e) {
        return false;
    }
}

/**
 * Open a user SQLite file by absolute path (cron / tooling). Path must resolve under the app data directory.
 */
function getPdoForUserSqlitePath(string $absolutePath): PDO {
    $normalized = str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $absolutePath);
    if (!is_file($normalized)) {
        throw new RuntimeException('SQLite file not found: ' . $absolutePath);
    }
    $realDb = realpath($normalized);
    if ($realDb === false) {
        throw new RuntimeException('SQLite path could not be resolved: ' . $absolutePath);
    }
    $dataDir = rtrim(str_replace(['/', '\\'], DIRECTORY_SEPARATOR, getDataDir()), DIRECTORY_SEPARATOR);
    $realData = realpath($dataDir);
    if ($realData === false) {
        throw new RuntimeException('Data directory could not be resolved.');
    }
    $prefix = $realData . DIRECTORY_SEPARATOR;
    if (strpos($realDb, $prefix) !== 0) {
        throw new RuntimeException('Database path must be under the application data directory.');
    }
    $pdo = new PDO('sqlite:' . $realDb, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec('PRAGMA foreign_keys = ON');
    runMigrationsIn($pdo, dirname(__DIR__) . '/migrations');
    return $pdo;
}
