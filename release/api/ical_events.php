<?php
/**
 * iCal feed events: GET ?from_date=&to_date= returns events from stored ical_feed_events.
 * Sync-and-store: optionally sync-if-stale (fetch URLs, parse, replace today+ in DB), then read from DB.
 */
require_once __DIR__ . '/common.php';
require_once dirname(__DIR__) . '/lib/logger.php';
require_once dirname(__DIR__) . '/lib/ical_parser.php';
require_once dirname(__DIR__) . '/lib/ical_completion.php';
require_once dirname(__DIR__) . '/lib/db.php';

/** Browser-like User-Agent so Google Calendar returns the full iCal feed (server agents often get truncated). */
define('ICAL_FETCH_USER_AGENT', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

/**
 * Fetch URL content using admin-configured method (curl or fopen).
 */
function icalFetchUrl(string $url, int $timeout): string|false {
    $method = getIcalFetchMethod();
    if ($method === 'curl' && function_exists('curl_init')) {
        $ch = curl_init($url);
        if ($ch === false) return false;
        $buffer = '';
        $writeFn = function ($ch, $data) use (&$buffer) {
            $buffer .= $data;
            return strlen($data);
        };
        curl_setopt_array($ch, [
            CURLOPT_WRITEFUNCTION => $writeFn,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 5,
            CURLOPT_TIMEOUT => max(60, $timeout),
            CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_USERAGENT => ICAL_FETCH_USER_AGENT,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_ENCODING => '',
            CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
        ]);
        $ok = curl_exec($ch);
        $err = curl_error($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($ok === false || $buffer === '') {
            if ($err) logError('WARNING', 'iCal cURL error: ' . $err, ['url' => $url, 'http_code' => $code]);
            return false;
        }
        return $buffer;
    }
    return @file_get_contents($url, false, stream_context_create([
        'http' => [
            'method' => 'GET',
            'timeout' => $timeout,
            'follow_location' => 1,
            'user_agent' => ICAL_FETCH_USER_AGENT,
        ],
        'ssl' => ['verify_peer' => true],
    ]));
}

/** Write sync state to last_fetch.json (merge with existing). Keys: state, subscription_id, feed_url?, message?, path?, saved_at?, parsed_count?, bytes_fetched?, error?, updated_at. */
function icalEventsWriteSyncState(array $data): void {
    $folder = getIcalSaveFolder();
    if (!is_dir($folder)) {
        @mkdir($folder, 0755, true);
    }
    $path = $folder . DIRECTORY_SEPARATOR . 'last_fetch.json';
    $existing = [];
    if (is_file($path)) {
        $decoded = @json_decode((string) file_get_contents($path), true);
        if (is_array($decoded)) {
            $existing = $decoded;
        }
    }
    $data['updated_at'] = date('Y-m-d\TH:i:s\Z');
    $merged = array_merge($existing, $data);
    @file_put_contents($path, json_encode($merged, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT), LOCK_EX);
}

/**
 * Ensure at most one .ics file in folder (for this subscription). Write raw to subscription_X_latest.ics.
 * If multiple .ics files exist, log and delete extras so only one remains (the one we're writing).
 */
function icalEventsWriteSingleFetchFile(string $raw, int $subscriptionId): void {
    if ($raw === '') {
        return;
    }
    $folder = getIcalSaveFolder();
    if (!is_dir($folder)) {
        @mkdir($folder, 0755, true);
    }
    $glob = $folder . DIRECTORY_SEPARATOR . '*.ics';
    $files = glob($glob);
    if ($files !== false && count($files) > 1) {
        logMessage('WARNING', 'ical_fetches: multiple files in directory, cleaning up (max one allowed)', ['count' => count($files), 'folder' => $folder]);
        foreach ($files as $f) {
            if (is_file($f)) {
                @unlink($f);
            }
        }
    } elseif ($files !== false && count($files) === 1) {
        @unlink($files[0]);
    }
    $filename = 'subscription_' . $subscriptionId . '_latest.ics';
    $path = $folder . DIRECTORY_SEPARATOR . $filename;
    $bytes = strlen($raw);
    if (@file_put_contents($path, $raw, LOCK_EX) !== false) {
        logMessage('INFO', 'ical fetch file saved', ['subscription_id' => $subscriptionId, 'filename' => $filename, 'bytes' => $bytes]);
        icalEventsWriteSyncState([
            'state' => 'saved_to_file',
            'path' => $path,
            'subscription_id' => $subscriptionId,
            'saved_at' => date('Y-m-d\TH:i:s\Z'),
        ]);
    }
}

/**
 * Read events from ical_feed_events for the given date range.
 * @return array{events: array, errors: array}
 */
function icalEventsReadFromDb(PDO $pdo, string $fromDate, string $toDate): array {
    $events = [];
    try {
        $stmt = $pdo->prepare("
            SELECT e.id, e.subscription_id, e.uid, e.title, e.start_iso, e.end_iso, e.all_day, e.user_completed, e.event_type
            FROM ical_feed_events e
            WHERE e.subscription_id IN (SELECT id FROM ical_subscriptions WHERE COALESCE(enabled, 1) = 1)
            AND date(e.start_iso) >= ?
            AND date(e.start_iso) <= ?
            ORDER BY e.start_iso, e.end_iso
        ");
        $stmt->execute([$fromDate, $toDate]);
        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $events[] = [
                'id' => (int) $row['id'],
                'uid' => $row['uid'],
                'title' => $row['title'],
                'start' => $row['start_iso'],
                'end' => $row['end_iso'],
                'allDay' => (int) $row['all_day'] === 1,
                'subscription_id' => (int) $row['subscription_id'],
                'user_completed' => (int) ($row['user_completed'] ?? 0) === 1,
                'event_type' => $row['event_type'] ?? 'event',
            ];
        }
    } catch (Throwable $e) {
        // Table may not exist before migration 013
        logMessage('INFO', 'ical_feed_events read skipped', ['message' => $e->getMessage()]);
    }
    return ['events' => $events, 'errors' => []];
}

/**
 * Ensure ical_feed_events table (and index) exist so sync can run even if migration 013 wasn't applied.
 */
function ensureIcalFeedEventsTable(PDO $pdo): void {
    $pdo->exec("CREATE TABLE IF NOT EXISTS ical_feed_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subscription_id INTEGER NOT NULL REFERENCES ical_subscriptions(id) ON DELETE CASCADE,
        uid TEXT NOT NULL,
        title TEXT NOT NULL,
        start_iso TEXT NOT NULL,
        end_iso TEXT NOT NULL,
        all_day INTEGER NOT NULL DEFAULT 0,
        user_completed INTEGER NOT NULL DEFAULT 0,
        event_type TEXT NOT NULL DEFAULT 'event'
    )");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_ical_feed_events_sub_start ON ical_feed_events (subscription_id, start_iso)");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_ical_feed_events_sub_uid_start ON ical_feed_events (subscription_id, uid, start_iso)");
}

/**
 * Run partial sync for one subscription: delete events from today onward, fetch, parse, insert.
 * @param int $staleThresholdSeconds If > 0, skip saving backup when existing backup is newer than this.
 * @return array{errors: array} feed errors for this subscription
 */
function icalEventsSyncSubscription(PDO $pdo, array $sub, string $today, string $toDate, int $timeout, int $staleThresholdSeconds = 0): array {
    $subId = (int) $sub['id'];
    $url = $sub['feed_url'];
    $feedErrors = [];

    ensureIcalFeedEventsTable($pdo);

    logMessage('INFO', 'ical sync step: downloading', ['subscription_id' => $subId, 'feed_url' => $url, 'range' => $today . '..' . $toDate]);
    icalEventsWriteSyncState(['state' => 'downloading', 'subscription_id' => $subId, 'feed_url' => $url, 'range_from' => $today, 'range_to' => $toDate]);

    logIcalFetchStart($subId, $url, $timeout);
    $t0 = microtime(true);
    $raw = icalFetchUrl($url, $timeout);
    $durationMs = (microtime(true) - $t0) * 1000;

    if ($raw === false || $raw === '') {
        $msg = 'Could not fetch calendar feed (timeout, unreachable, or server cannot open URLs).';
        logIcalFetchFailure($subId, $msg, $url);
        logMessage('WARNING', 'ical sync step: error (fetch failed)', ['subscription_id' => $subId, 'message' => $msg]);
        icalEventsWriteSyncState(['state' => 'error', 'subscription_id' => $subId, 'message' => $msg, 'error' => $msg]);
        logError('WARNING', $msg, ['feed_url' => $url]);
        $feedErrors[] = ['feed_url' => $url, 'message' => $msg];
        return $feedErrors;
    }

    logMessage('INFO', 'ical sync step: fetched', ['subscription_id' => $subId, 'bytes' => strlen($raw), 'duration_ms' => round($durationMs, 2)]);
    icalEventsWriteSyncState(['state' => 'parsing', 'subscription_id' => $subId, 'bytes_fetched' => strlen($raw)]);

    logIcalFetchSuccess($subId, strlen($raw), $durationMs);
    icalEventsWriteSingleFetchFile($raw, $subId);

    if (stripos($raw, 'BEGIN:VCALENDAR') === false) {
        $msg = 'Feed did not return valid iCal (expected VCALENDAR).';
        logError('WARNING', $msg, ['feed_url' => $url]);
        logMessage('WARNING', 'ical sync step: error (invalid feed)', ['subscription_id' => $subId, 'message' => $msg]);
        icalEventsWriteSyncState(['state' => 'error', 'subscription_id' => $subId, 'message' => $msg, 'error' => $msg]);
        $feedErrors[] = ['feed_url' => $url, 'message' => $msg];
        return $feedErrors;
    }

    $veventCount = substr_count($raw, 'BEGIN:VEVENT');
    logMessage('INFO', 'ical sync step: parsing', ['subscription_id' => $subId, 'vevents_in_feed' => $veventCount, 'range' => $today . '..' . $toDate]);
    try {
        $parsed = parseIcalEvents($raw, $today, $toDate);
    } catch (Throwable $e) {
        $msg = 'Parse error: ' . $e->getMessage();
        logError('WARNING', $msg, ['feed_url' => $url]);
        logMessage('WARNING', 'ical sync step: error (parse)', ['subscription_id' => $subId, 'message' => $msg]);
        icalEventsWriteSyncState(['state' => 'error', 'subscription_id' => $subId, 'message' => $msg, 'error' => $msg]);
        $feedErrors[] = ['feed_url' => $url, 'message' => $msg];
        return $feedErrors;
    }

    $parsedCount = count($parsed);
    logMessage('INFO', 'ical sync step: parsed', ['subscription_id' => $subId, 'events_count' => $parsedCount, 'range' => $today . '..' . $toDate]);
    icalEventsWriteSyncState(['state' => 'saving', 'subscription_id' => $subId, 'parsed_count' => $parsedCount]);

    logMessage('INFO', 'ical sync step: saving to DB', ['subscription_id' => $subId]);
    try {
        // Preserve completion markers for each individual occurrence.
        // Completion is keyed by (subscription_id, uid, start_iso) so recurring feeds don't collapse occurrences together.
        $existingCompletedByKey = [];
        try {
            $stmt = $pdo->prepare('SELECT uid, start_iso, user_completed FROM ical_feed_events WHERE subscription_id = ? AND date(start_iso) >= ?');
            $stmt->execute([$subId, $today]);
            while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
                $key = icalCompletionKey((string) ($row['uid'] ?? ''), (string) ($row['start_iso'] ?? ''));
                $existingCompletedByKey[$key] = ((int) ($row['user_completed'] ?? 0) === 1) ? 1 : 0;
            }
        } catch (Throwable $e) {
            // If the table doesn't have the expected columns, fall back to defaults.
        }
        // §5.15: merge persistent marks (events removed from feed or rows deleted before re-insert).
        $marksMap = icalLoadCompletionMarks($pdo, $subId);
        $existingCompletedByKey = icalMergeCompletionWithMarks($existingCompletedByKey, $marksMap);

        $del = $pdo->prepare("DELETE FROM ical_feed_events WHERE subscription_id = ? AND date(start_iso) >= ?");
        $del->execute([$subId, $today]);
    } catch (Throwable $e) {
        logError('WARNING', 'ical_feed_events delete failed', ['subscription_id' => $subId, 'message' => $e->getMessage()]);
        logMessage('WARNING', 'ical sync step: error (delete failed)', ['subscription_id' => $subId, 'message' => $e->getMessage()]);
        icalEventsWriteSyncState(['state' => 'error', 'subscription_id' => $subId, 'message' => $e->getMessage(), 'error' => 'delete failed']);
        return $feedErrors;
    }

    try {
        $insert = $pdo->prepare("INSERT INTO ical_feed_events (subscription_id, uid, title, start_iso, end_iso, all_day, user_completed, event_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
        foreach ($parsed as $ev) {
            $uid = (string) ($ev['uid'] ?? '');
            $start = (string) ($ev['start'] ?? '');
            $uc = icalGetUserCompletedFromMap($existingCompletedByKey ?? [], $uid, $start);
            $insert->execute([
                $subId,
                $uid,
                $ev['title'] ?? 'Event',
                $start,
                $ev['end'] ?? $start,
                isset($ev['allDay']) && $ev['allDay'] ? 1 : 0,
                $uc,
                $ev['event_type'] ?? 'event',
            ]);
            if ($uc === 1) {
                icalUpsertCompletionMark($pdo, $subId, $uid, $start, 1);
            }
        }
    } catch (Throwable $e) {
        logError('WARNING', 'ical_feed_events insert failed', [
            'subscription_id' => $subId,
            'message' => $e->getMessage(),
            'parsed_count' => $parsedCount,
        ]);
        logMessage('WARNING', 'ical sync step: error (insert failed)', ['subscription_id' => $subId, 'message' => $e->getMessage()]);
        icalEventsWriteSyncState(['state' => 'error', 'subscription_id' => $subId, 'message' => $e->getMessage(), 'error' => 'insert failed', 'parsed_count' => $parsedCount]);
        $feedErrors[] = ['feed_url' => $url, 'message' => 'Failed to save events to database: ' . $e->getMessage()];
        return $feedErrors;
    }

    logMessage('INFO', 'ical sync step: saved to DB', ['subscription_id' => $subId, 'events_count' => $parsedCount, 'parse_range' => $today . '..' . $toDate]);

    $folder = getIcalSaveFolder();
    $fetchFilePath = $folder . DIRECTORY_SEPARATOR . 'subscription_' . $subId . '_latest.ics';
    if (!getIcalSaveLastFetch() && is_file($fetchFilePath)) {
        @unlink($fetchFilePath);
        logMessage('INFO', 'ical fetch file deleted after parsing', ['subscription_id' => $subId, 'filename' => 'subscription_' . $subId . '_latest.ics', 'parse_range' => $today . '..' . $toDate]);
    }

    $now = date('Y-m-d\TH:i:s\Z');
    try {
        $up = $pdo->prepare("UPDATE ical_subscriptions SET last_synced_at = ? WHERE id = ?");
        $up->execute([$now, $subId]);
    } catch (Throwable $e) {
        // Column may not exist if migration 013 not applied
    }

    logMessage('INFO', 'ical sync step: synced', ['subscription_id' => $subId, 'events_count' => $parsedCount, 'range' => $today . '..' . $toDate]);
    icalEventsWriteSyncState([
        'state' => 'synced',
        'subscription_id' => $subId,
        'parsed_count' => $parsedCount,
        'saved_at' => $now,
        'bytes_fetched' => strlen($raw),
        'range_from' => $today,
        'range_to' => $toDate,
    ]);
    return $feedErrors;
}

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
    logMessage('INFO', 'ical_events config');
    jsonResponse([
        'interval_fetch' => getIcalIntervalFetchEnabled(),
        'interval_minutes' => getIcalSyncIntervalMinutes(),
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

// Master: check ical_subscriptions_enabled and sync_mode for manual
try {
    $master = getMasterPdo();
    $stmt = $master->query("SELECT value FROM app_settings WHERE key = 'ical_subscriptions_enabled'");
    $row = $stmt ? $stmt->fetch(PDO::FETCH_ASSOC) : null;
    if ($row && $row['value'] === '0') {
        jsonResponse(['events' => [], 'errors' => []]);
        exit;
    }
} catch (Throwable $e) {
    // continue
}

$pdo = getPdoSafe();
$forceSync = isset($_GET['force_sync']) && $_GET['force_sync'] !== '' && $_GET['force_sync'] !== '0';
$syncIfStale = isset($_GET['sync_if_stale']) && $_GET['sync_if_stale'] !== '' && $_GET['sync_if_stale'] !== '0';

// Load subscriptions (with last_synced_at if column exists)
try {
    $stmt = $pdo->query('SELECT id, feed_url, last_synced_at FROM ical_subscriptions WHERE COALESCE(enabled, 1) = 1 ORDER BY id');
    $subscriptions = $stmt ? $stmt->fetchAll(PDO::FETCH_ASSOC) : [];
} catch (Throwable $e) {
    try {
        $stmt = $pdo->query('SELECT id, feed_url FROM ical_subscriptions WHERE COALESCE(enabled, 1) = 1 ORDER BY id');
        $subscriptions = $stmt ? $stmt->fetchAll(PDO::FETCH_ASSOC) : [];
        foreach ($subscriptions as &$s) {
            $s['last_synced_at'] = null;
        }
        unset($s);
    } catch (Throwable $e2) {
        $subscriptions = [];
    }
}

$allErrors = [];

// Sync if stale (or always if force_sync), then return from DB.
// Use UTC for today/range so the parse range matches feed times (typically UTC). Range is admin-configurable.
$today = gmdate('Y-m-d');
$rangeDays = getIcalEventRangeDays();
$toDateSync = gmdate('Y-m-d', strtotime('+' . $rangeDays . ' days'));
logMessage('INFO', 'ical_events sync date range (UTC)', ['today' => $today, 'to_date_sync' => $toDateSync, 'range_days' => $rangeDays]);
$staleMinutes = getIcalSyncStaleMinutes();
$staleThreshold = $staleMinutes * 60; // seconds

// If any subscription has never been synced, sync it (so first load populates ical_feed_events even without sync_if_stale)
$anyNeverSynced = false;
foreach ($subscriptions as $sub) {
    $ls = isset($sub['last_synced_at']) ? trim((string) $sub['last_synced_at']) : null;
    if ($ls === null || $ls === '') {
        $anyNeverSynced = true;
        break;
    }
}
if ($anyNeverSynced && !$forceSync && !$syncIfStale) {
    $syncIfStale = true;
}
logMessage('INFO', 'ical_events sync check', ['sync_if_stale' => $syncIfStale, 'force_sync' => $forceSync, 'subscriptions_count' => count($subscriptions)]);

foreach ($subscriptions as $sub) {
    $subId = (int) $sub['id'];
    $lastSynced = isset($sub['last_synced_at']) ? trim((string) $sub['last_synced_at']) : null;
    $shouldSync = $forceSync;
    $reason = '';
    if (!$shouldSync && $syncIfStale) {
        if ($lastSynced === null || $lastSynced === '') {
            $shouldSync = true;
            $reason = 'first_sync';
        } else {
            $lastTs = @strtotime($lastSynced);
            if ($lastTs !== false && (time() - $lastTs) >= $staleThreshold) {
                $shouldSync = true;
                $reason = 'stale';
            }
        }
    } elseif ($shouldSync) {
        $reason = 'force';
    }
    if (!$shouldSync) {
        continue;
    }
    logMessage('INFO', 'ical_events syncing subscription', ['subscription_id' => $subId, 'reason' => $reason]);
    $icalTimeout = getIcalFetchTimeout();
    $errs = icalEventsSyncSubscription($pdo, $sub, $today, $toDateSync, $icalTimeout, $staleThreshold);
    $allErrors = array_merge($allErrors, $errs);
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
logMessage('INFO', 'ical_events ok', ['events_count' => count($events), 'errors_count' => count($allErrors)]);
jsonResponse(['events' => $events, 'errors' => $allErrors]);
