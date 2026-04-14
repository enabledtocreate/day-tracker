<?php
/**
 * iCal feed events: GET ?from_date=&to_date= returns events from stored ical_feed_events.
 * Sync-and-store: optionally sync-if-stale (unless admin "Use Cron Job" is on), then read from DB.
 */
require_once __DIR__ . '/common.php';
require_once dirname(__DIR__) . '/lib/ical_events_sync_core.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'PATCH') {
    $in = readJsonInput();
    $id = isset($in['id']) ? (int) $in['id'] : 0;
    $userCompleted = isset($in['user_completed']) && ($in['user_completed'] === true || $in['user_completed'] === 1 || $in['user_completed'] === '1');
    if ($id < 1) {
        jsonError('id required (positive integer)');
        exit;
    }
    $pdo = getPdoSafe();
    try {
        $rowStmt = $pdo->prepare('SELECT subscription_id, uid, start_iso FROM ical_feed_events WHERE id = ?');
        $rowStmt->execute([$id]);
        $evRow = $rowStmt->fetch(PDO::FETCH_ASSOC);
        $stmt = $pdo->prepare('UPDATE ical_feed_events SET user_completed = ? WHERE id = ?');
        $stmt->execute([$userCompleted ? 1 : 0, $id]);
        if ($evRow && isset($evRow['subscription_id'], $evRow['uid'], $evRow['start_iso'])) {
            icalUpsertCompletionMark(
                $pdo,
                (int) $evRow['subscription_id'],
                (string) $evRow['uid'],
                (string) $evRow['start_iso'],
                $userCompleted ? 1 : 0
            );
        }
        logMessage('INFO', 'ical_feed_events user_completed updated', ['id' => $id, 'user_completed' => $userCompleted]);
        jsonResponse(['ok' => true]);
    } catch (Throwable $e) {
        logMessage('WARNING', 'ical_feed_events PATCH failed', ['id' => $id, 'message' => $e->getMessage()]);
        jsonError('Update failed', 500);
    }
    exit;
}
if ($method !== 'GET') {
    logMessage('WARNING', 'ical_events method not allowed');
    header('Allow: GET, PATCH', true, 405);
    exit;
}

$configOnly = isset($_GET['config']) && $_GET['config'] !== '' && $_GET['config'] !== '0';
if ($configOnly) {
    $useCron = getIcalUseCronJob();
    logMessage('INFO', 'ical_events config');
    jsonResponse([
        'interval_fetch' => getIcalIntervalFetchEnabled(),
        'interval_minutes' => getIcalSyncIntervalMinutes(),
        'use_cron_job' => $useCron,
        'client_triggers_sync' => !$useCron,
    ]);
    exit;
}

$fromDate = isset($_GET['from_date']) ? trim((string) $_GET['from_date']) : '';
$toDate = isset($_GET['to_date']) ? trim((string) $_GET['to_date']) : '';
logMessage('INFO', 'ical_events.php GET', ['from_date' => $fromDate, 'to_date' => $toDate, 'user_id' => $userId]);
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $fromDate) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $toDate)) {
    logMessage('WARNING', 'ical_events validation failed');
    jsonError('from_date and to_date required (YYYY-MM-DD)');
    exit;
}

try {
    $master = getMasterPdo();
    $stmt = $master->query("SELECT value FROM app_settings WHERE key = 'ical_subscriptions_enabled'");
    $row = $stmt ? $stmt->fetch(PDO::FETCH_ASSOC) : null;
    if ($row && $row['value'] === '0') {
        jsonResponse(['events' => [], 'errors' => [], 'subscription_sync' => []]);
        exit;
    }
} catch (Throwable $e) {
}

$pdo = getPdoSafe();
$forceSync = isset($_GET['force_sync']) && $_GET['force_sync'] !== '' && $_GET['force_sync'] !== '0';
$syncIfStale = isset($_GET['sync_if_stale']) && $_GET['sync_if_stale'] !== '' && $_GET['sync_if_stale'] !== '0';
$useCron = getIcalUseCronJob();

try {
    $stmt = $pdo->query('SELECT id, feed_url, last_synced_at FROM ical_subscriptions WHERE COALESCE(enabled, 1) = 1 ORDER BY id');
    $subscriptions = $stmt ? $stmt->fetchAll(PDO::FETCH_ASSOC) : [];
} catch (Throwable $e) {
    logMessage('NOTICE', 'ical_events: subscriptions query without last_synced_at', ['message' => $e->getMessage()]);
    try {
        $stmt = $pdo->query('SELECT id, feed_url FROM ical_subscriptions WHERE COALESCE(enabled, 1) = 1 ORDER BY id');
        $subscriptions = $stmt ? $stmt->fetchAll(PDO::FETCH_ASSOC) : [];
        foreach ($subscriptions as &$s) {
            $s['last_synced_at'] = null;
        }
        unset($s);
    } catch (Throwable $e2) {
        logMessage('WARNING', 'ical_events: subscriptions list failed', ['message' => $e2->getMessage()]);
        $subscriptions = [];
    }
}

$allErrors = [];
$subscriptionSyncReport = [];

if ($useCron && !$forceSync) {
    foreach ($subscriptions as $sub) {
        $subscriptionSyncReport[] = [
            'subscription_id' => (int) $sub['id'],
            'attempted' => false,
            'skip_reason' => 'cron_managed',
        ];
    }
    logMessage('INFO', 'ical_events sync skipped (cron_managed)', ['subscriptions_count' => count($subscriptions)]);
} else {
    $anyNeverSynced = false;
    foreach ($subscriptions as $sub) {
        $ls = isset($sub['last_synced_at']) ? trim((string) $sub['last_synced_at']) : null;
        if ($ls === null || $ls === '') {
            $anyNeverSynced = true;
            break;
        }
    }
    if ($anyNeverSynced && !$forceSync && !$syncIfStale && !$useCron) {
        $syncIfStale = true;
    }
    logMessage('INFO', 'ical_events sync check', ['sync_if_stale' => $syncIfStale, 'force_sync' => $forceSync, 'subscriptions_count' => count($subscriptions), 'use_cron' => $useCron]);
    $r = icalEventsRunSyncSubscriptionsForPdo($pdo, $forceSync, $syncIfStale);
    $allErrors = $r['allErrors'];
    $subscriptionSyncReport = $r['subscription_sync'];
}

$result = icalEventsReadFromDb($pdo, $fromDate, $toDate);
$events = $result['events'];
$omitUids = getIcalOmitUids();
if (!empty($omitUids)) {
    $omitSet = array_fill_keys(array_map('strval', $omitUids), true);
    $events = array_values(array_filter($events, function (array $ev) use ($omitSet) {
        return !isset($omitSet[trim((string) ($ev['uid'] ?? ''))]);
    }));
}
logMessage('INFO', 'ical_events ok', [
    'events_count' => count($events),
    'errors_count' => count($allErrors),
    'subscription_sync' => $subscriptionSyncReport,
]);
jsonResponse([
    'events' => $events,
    'errors' => $allErrors,
    'subscription_sync' => $subscriptionSyncReport,
]);
