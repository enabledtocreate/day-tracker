<?php
/**
 * Server-side iCal sync for every user. Intended for crontab when Admin "Use Cron Job" is enabled.
 *
 * Schedule your system crontab so the script runs about as often as Admin → iCal → Sync interval (minutes).
 * That value is also used as the staleness window, so spacing cron runs to match it avoids no-op passes.
 * Example (every 15 minutes; avoid star-slash inside this comment):
 *   0,15,30,45 * * * * /usr/bin/php /path/to/app/cron/ical_sync_all_users.php >> /path/to/data/ical_cron.log 2>&1
 *
 * Exits early if ical_subscriptions_enabled is off or ical_use_cron_job is not set.
 */
declare(strict_types=1);

require_once dirname(__DIR__) . '/lib/logger.php';
require_once dirname(__DIR__) . '/lib/db.php';
require_once dirname(__DIR__) . '/lib/ical_events_sync_core.php';

try {
    $master = getMasterPdo();
} catch (Throwable $e) {
    fwrite(STDERR, 'ical_sync_all_users: master DB unavailable: ' . $e->getMessage() . PHP_EOL);
    exit(1);
}

$stmt = $master->query("SELECT value FROM app_settings WHERE key = 'ical_subscriptions_enabled'");
$row = $stmt ? $stmt->fetch(PDO::FETCH_ASSOC) : null;
if ($row && trim((string) ($row['value'] ?? '')) === '0') {
    logMessage('INFO', 'ical_sync_all_users: ical_subscriptions_enabled off, skip');
    exit(0);
}

$stmt = $master->query("SELECT value FROM app_settings WHERE key = 'ical_use_cron_job'");
$rowCron = $stmt ? $stmt->fetch(PDO::FETCH_ASSOC) : null;
if (!$rowCron || trim((string) ($rowCron['value'] ?? '')) !== '1') {
    logMessage('INFO', 'ical_sync_all_users: ical_use_cron_job off, skip');
    exit(0);
}

$dataDir = getDataDir();
$stmt = $master->query('SELECT id, username, db_name FROM users ORDER BY id');
$users = $stmt ? $stmt->fetchAll(PDO::FETCH_ASSOC) : [];
logMessage('INFO', 'ical_sync_all_users: start', ['users' => count($users)]);

foreach ($users as $u) {
    $uid = (int) $u['id'];
    $name = (string) $u['username'];
    $dbName = (string) $u['db_name'];
    $path = $dataDir . DIRECTORY_SEPARATOR . $dbName;
    if (!is_file($path)) {
        logMessage('WARNING', 'ical_sync_all_users: missing user db', ['user_id' => $uid, 'username' => $name, 'path' => $path]);
        continue;
    }
    try {
        $pdo = getPdoForUserSqlitePath($path);
        // Use the same per-user lock file as api/ical_events.php so the cron
        // and HTTP-driven syncs serialize against each other. If a device is
        // currently downloading, the cron quietly skips this user.
        $lockFilePath = $path . '.ical-sync.lock';
        $r = icalEventsRunSyncSubscriptionsForPdo($pdo, false, true, $lockFilePath);
        logMessage('INFO', 'ical_sync_all_users: user ok', [
            'user_id' => $uid,
            'username' => $name,
            'error_groups' => count($r['allErrors']),
            'subscriptions_reported' => count($r['subscription_sync'] ?? []),
        ]);
    } catch (Throwable $e) {
        logError('ERROR', 'ical_sync_all_users: user failed', [
            'user_id' => $uid,
            'username' => $name,
            'message' => $e->getMessage(),
            'file' => $e->getFile(),
            'line' => $e->getLine(),
        ]);
    }
}

logMessage('INFO', 'ical_sync_all_users: done');
exit(0);
