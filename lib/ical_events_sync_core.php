<?php
/**
 * iCal feed fetch, parse, DB sync (shared by api/ical_events.php and cron/ical_sync_all_users.php).
 * Does not perform HTTP; callers must load auth/db as needed.
 */
if (!defined('ICAL_FETCH_USER_AGENT')) {
    define('ICAL_FETCH_USER_AGENT', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
}

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/logger.php';
require_once __DIR__ . '/ical_parser.php';
require_once __DIR__ . '/ical_completion.php';
require_once __DIR__ . '/ical_subscription_sync.php';

/**
 * Fetch URL into memory (small previews, tools).
 */
function icalFetchUrl(string $url, int $timeout): string|false {
    $method = getIcalFetchMethod();
    if ($method === 'curl' && function_exists('curl_init')) {
        $ch = curl_init($url);
        if ($ch === false) {
            return false;
        }
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
            if ($err) {
                logError('WARNING', 'iCal cURL error: ' . $err, ['url' => $url, 'http_code' => $code]);
            }

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

/**
 * Stream a remote iCal feed to disk (memory-efficient download). Returns bytes written or false.
 * TODO: incremental/parse-while-streaming for very large feeds still loads full file at parse time.
 */
function icalFetchIcalFeedToFile(string $url, int $timeout, string $destPath): int|false {
    $method = getIcalFetchMethod();
    if ($method === 'curl' && function_exists('curl_init')) {
        $fp = fopen($destPath, 'wb');
        if ($fp === false) {
            return false;
        }
        $ch = curl_init($url);
        if ($ch === false) {
            fclose($fp);
            @unlink($destPath);

            return false;
        }
        curl_setopt_array($ch, [
            CURLOPT_FILE => $fp,
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
        curl_close($ch);
        fclose($fp);
        if (!$ok) {
            if ($err) {
                logError('WARNING', 'iCal stream cURL error: ' . $err, ['url' => $url]);
            }
            @unlink($destPath);

            return false;
        }
        clearstatcache(true, $destPath);
        $sz = filesize($destPath);

        return $sz !== false ? (int) $sz : false;
    }

    $ctx = stream_context_create([
        'http' => [
            'method' => 'GET',
            'timeout' => $timeout,
            'follow_location' => 1,
            'user_agent' => ICAL_FETCH_USER_AGENT,
        ],
        'ssl' => ['verify_peer' => true],
    ]);
    $in = @fopen($url, 'rb', false, $ctx);
    $out = fopen($destPath, 'wb');
    if ($in === false || $out === false) {
        if (is_resource($in)) {
            fclose($in);
        }
        if (is_resource($out)) {
            fclose($out);
        }
        @unlink($destPath);

        return false;
    }
    $copied = stream_copy_to_stream($in, $out);
    fclose($in);
    fclose($out);
    if ($copied === false) {
        @unlink($destPath);

        return false;
    }

    return (int) $copied;
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
        logMessage('INFO', 'ical_feed_events read skipped', ['message' => $e->getMessage()]);
    }

    return ['events' => $events, 'errors' => []];
}

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
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_ical_feed_events_sub_start ON ical_feed_events (subscription_id, start_iso)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_ical_feed_events_sub_uid_start ON ical_feed_events (subscription_id, uid, start_iso)');
}

/**
 * @return array{errors: array<int, array{feed_url: string, message: string}>}
 */
function icalEventsSyncSubscription(PDO $pdo, array $sub, string $today, string $toDate, int $timeout, int $staleThresholdSeconds = 0): array {
    $subId = (int) $sub['id'];
    $url = $sub['feed_url'];
    $feedErrors = [];

    ensureIcalFeedEventsTable($pdo);

    logMessage('INFO', 'ical sync step: downloading', ['subscription_id' => $subId, 'feed_url' => $url, 'range' => $today . '..' . $toDate]);
    icalSubscriptionSyncStatusWrite($pdo, $subId, [
        'state' => 'downloading',
        'feed_url' => $url,
        'range_from' => $today,
        'range_to' => $toDate,
        'message' => null,
        'error' => null,
    ]);

    logIcalFetchStart($subId, $url, $timeout);
    $t0 = microtime(true);
    $folder = getIcalSaveFolder();
    if (!is_dir($folder)) {
        @mkdir($folder, 0755, true);
    }
    $partPath = $folder . DIRECTORY_SEPARATOR . 'subscription_' . $subId . '_latest.ics.part';
    $finalPath = $folder . DIRECTORY_SEPARATOR . 'subscription_' . $subId . '_latest.ics';
    if (is_file($partPath)) {
        @unlink($partPath);
    }

    $bytesWritten = icalFetchIcalFeedToFile($url, $timeout, $partPath);
    $durationMs = (microtime(true) - $t0) * 1000;

    if ($bytesWritten === false || $bytesWritten === 0) {
        @unlink($partPath);
        $msg = 'Could not fetch calendar feed (timeout, unreachable, or server cannot open URLs).';
        logIcalFetchFailure($subId, $msg, $url);
        logMessage('WARNING', 'ical sync step: error (fetch failed)', ['subscription_id' => $subId, 'message' => $msg]);
        icalSubscriptionSyncStatusWrite($pdo, $subId, ['state' => 'error', 'message' => $msg, 'error' => $msg]);
        logError('WARNING', $msg, ['feed_url' => $url]);
        $feedErrors[] = ['feed_url' => $url, 'message' => $msg];

        return $feedErrors;
    }

    if (is_file($finalPath)) {
        @unlink($finalPath);
    }
    if (!@rename($partPath, $finalPath)) {
        @unlink($partPath);
        $msg = 'Could not finalize downloaded calendar file.';
        icalSubscriptionSyncStatusWrite($pdo, $subId, ['state' => 'error', 'message' => $msg, 'error' => $msg]);
        $feedErrors[] = ['feed_url' => $url, 'message' => $msg];

        return $feedErrors;
    }

    $raw = @file_get_contents($finalPath);
    if ($raw === false || $raw === '') {
        $msg = 'Downloaded calendar file was empty.';
        icalSubscriptionSyncStatusWrite($pdo, $subId, ['state' => 'error', 'message' => $msg, 'error' => $msg]);
        $feedErrors[] = ['feed_url' => $url, 'message' => $msg];

        return $feedErrors;
    }

    logMessage('INFO', 'ical sync step: fetched', ['subscription_id' => $subId, 'bytes' => strlen($raw), 'duration_ms' => round($durationMs, 2)]);
    icalSubscriptionSyncStatusWrite($pdo, $subId, [
        'state' => 'parsing',
        'bytes_fetched' => strlen($raw),
        'path' => $finalPath,
    ]);

    logIcalFetchSuccess($subId, strlen($raw), $durationMs);

    if (stripos($raw, 'BEGIN:VCALENDAR') === false) {
        $msg = 'Feed did not return valid iCal (expected VCALENDAR).';
        logError('WARNING', $msg, ['feed_url' => $url]);
        logMessage('WARNING', 'ical sync step: error (invalid feed)', ['subscription_id' => $subId, 'message' => $msg]);
        icalSubscriptionSyncStatusWrite($pdo, $subId, ['state' => 'error', 'message' => $msg, 'error' => $msg]);
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
        icalSubscriptionSyncStatusWrite($pdo, $subId, ['state' => 'error', 'message' => $msg, 'error' => $msg]);
        $feedErrors[] = ['feed_url' => $url, 'message' => $msg];

        return $feedErrors;
    }

    $parsedCount = count($parsed);
    logMessage('INFO', 'ical sync step: parsed', ['subscription_id' => $subId, 'events_count' => $parsedCount, 'range' => $today . '..' . $toDate]);
    icalSubscriptionSyncStatusWrite($pdo, $subId, ['state' => 'saving', 'parsed_count' => $parsedCount]);

    logMessage('INFO', 'ical sync step: saving to DB', ['subscription_id' => $subId]);
    try {
        $existingCompletedByKey = [];
        try {
            $stmt = $pdo->prepare('SELECT uid, start_iso, user_completed FROM ical_feed_events WHERE subscription_id = ? AND date(start_iso) >= ?');
            $stmt->execute([$subId, $today]);
            while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
                $key = icalCompletionKey((string) ($row['uid'] ?? ''), (string) ($row['start_iso'] ?? ''));
                $existingCompletedByKey[$key] = ((int) ($row['user_completed'] ?? 0) === 1) ? 1 : 0;
            }
        } catch (Throwable $e) {
        }
        $marksMap = icalLoadCompletionMarks($pdo, $subId);
        $existingCompletedByKey = icalMergeCompletionWithMarks($existingCompletedByKey, $marksMap);

        $del = $pdo->prepare('DELETE FROM ical_feed_events WHERE subscription_id = ? AND date(start_iso) >= ?');
        $del->execute([$subId, $today]);
    } catch (Throwable $e) {
        logError('WARNING', 'ical_feed_events delete failed', ['subscription_id' => $subId, 'message' => $e->getMessage()]);
        logMessage('WARNING', 'ical sync step: error (delete failed)', ['subscription_id' => $subId, 'message' => $e->getMessage()]);
        icalSubscriptionSyncStatusWrite($pdo, $subId, ['state' => 'error', 'message' => $e->getMessage(), 'error' => 'delete failed']);

        return $feedErrors;
    }

    try {
        $insert = $pdo->prepare('INSERT INTO ical_feed_events (subscription_id, uid, title, start_iso, end_iso, all_day, user_completed, event_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
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
        icalSubscriptionSyncStatusWrite($pdo, $subId, ['state' => 'error', 'message' => $e->getMessage(), 'error' => 'insert failed', 'parsed_count' => $parsedCount]);
        $feedErrors[] = ['feed_url' => $url, 'message' => 'Failed to save events to database: ' . $e->getMessage()];

        return $feedErrors;
    }

    logMessage('INFO', 'ical sync step: saved to DB', ['subscription_id' => $subId, 'events_count' => $parsedCount, 'parse_range' => $today . '..' . $toDate]);

    if (!getIcalSaveLastFetch() && is_file($finalPath)) {
        @unlink($finalPath);
        logMessage('INFO', 'ical fetch file deleted after parsing', ['subscription_id' => $subId, 'filename' => 'subscription_' . $subId . '_latest.ics', 'parse_range' => $today . '..' . $toDate]);
        icalSubscriptionSyncStatusWrite($pdo, $subId, ['fetch_file_path' => null, 'path' => null]);
    }

    $now = date('Y-m-d\TH:i:s\Z');
    try {
        $up = $pdo->prepare('UPDATE ical_subscriptions SET last_synced_at = ? WHERE id = ?');
        $up->execute([$now, $subId]);
    } catch (Throwable $e) {
        logMessage('NOTICE', 'ical sync: last_synced_at update skipped', ['subscription_id' => $subId, 'message' => $e->getMessage()]);
    }

    logMessage('INFO', 'ical sync step: synced', ['subscription_id' => $subId, 'events_count' => $parsedCount, 'range' => $today . '..' . $toDate]);
    $syncPatch = [
        'state' => 'synced',
        'parsed_count' => $parsedCount,
        'bytes_fetched' => strlen($raw),
        'range_from' => $today,
        'range_to' => $toDate,
        'message' => null,
        'error' => null,
    ];
    if (getIcalSaveLastFetch() && is_file($finalPath)) {
        $syncPatch['path'] = $finalPath;
    }
    icalSubscriptionSyncStatusWrite($pdo, $subId, $syncPatch);

    return $feedErrors;
}

/**
 * Load enabled subscriptions and run conditional sync (same rules as HTTP GET).
 *
 * @return array{allErrors: array, subscription_sync: array}
 */
function icalEventsRunSyncSubscriptionsForPdo(PDO $pdo, bool $forceSync, bool $syncIfStale): array {
    try {
        $stmt = $pdo->query('SELECT id, feed_url, last_synced_at FROM ical_subscriptions WHERE COALESCE(enabled, 1) = 1 ORDER BY id');
        $subscriptions = $stmt ? $stmt->fetchAll(PDO::FETCH_ASSOC) : [];
    } catch (Throwable $e) {
        logMessage('NOTICE', 'ical sync: subscriptions query without last_synced_at', ['message' => $e->getMessage()]);
        try {
            $stmt = $pdo->query('SELECT id, feed_url FROM ical_subscriptions WHERE COALESCE(enabled, 1) = 1 ORDER BY id');
            $subscriptions = $stmt ? $stmt->fetchAll(PDO::FETCH_ASSOC) : [];
            foreach ($subscriptions as &$s) {
                $s['last_synced_at'] = null;
            }
            unset($s);
        } catch (Throwable $e2) {
            logMessage('WARNING', 'ical sync: subscriptions list failed', ['message' => $e2->getMessage()]);
            $subscriptions = [];
        }
    }

    $today = gmdate('Y-m-d');
    $rangeDays = getIcalEventRangeDays();
    $toDateSync = gmdate('Y-m-d', strtotime('+' . $rangeDays . ' days'));
    $staleMinutes = getIcalSyncStaleMinutes();
    $staleThreshold = $staleMinutes * 60;

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

    $allErrors = [];
    $subscriptionSyncReport = [];
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
                if ($lastTs === false) {
                    $shouldSync = true;
                    $reason = 'invalid_last_sync_timestamp';
                } elseif ((time() - $lastTs) >= $staleThreshold) {
                    $shouldSync = true;
                    $reason = 'stale';
                }
            }
        } elseif ($shouldSync) {
            $reason = 'force';
        }
        if (!$shouldSync) {
            $subscriptionSyncReport[] = [
                'subscription_id' => $subId,
                'attempted' => false,
                'skip_reason' => 'cache_fresh',
            ];
            continue;
        }
        logMessage('INFO', 'ical_events syncing subscription', ['subscription_id' => $subId, 'reason' => $reason]);
        $icalTimeout = getIcalFetchTimeout();
        $errs = icalEventsSyncSubscription($pdo, $sub, $today, $toDateSync, $icalTimeout, $staleThreshold);
        $allErrors = array_merge($allErrors, $errs);
        $subscriptionSyncReport[] = [
            'subscription_id' => $subId,
            'attempted' => true,
            'trigger_reason' => $reason,
            'feed_errors' => $errs,
        ];
    }

    return ['allErrors' => $allErrors, 'subscription_sync' => $subscriptionSyncReport];
}
