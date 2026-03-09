<?php
/**
 * iCal subscriptions: list, add, remove feed URLs for the current user.
 */
require_once __DIR__ . '/common.php';
require_once dirname(__DIR__) . '/lib/logger.php';
require_once dirname(__DIR__) . '/lib/db.php';

/** Browser-like User-Agent so Google Calendar returns the full iCal feed (server agents often get truncated). */
define('ICAL_FETCH_USER_AGENT', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

/** Fetch URL using admin-configured method (curl or fopen). */
function icalFetchUrl(string $url, int $timeout): string|false {
    $method = getIcalFetchMethod();
    if ($method === 'curl' && function_exists('curl_init')) {
        $ch = curl_init($url);
        if ($ch === false) return false;
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 5,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_USERAGENT => ICAL_FETCH_USER_AGENT,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_ENCODING => '',
        ]);
        $raw = curl_exec($ch);
        curl_close($ch);
        return $raw !== false ? $raw : false;
    }
    $context = stream_context_create([
        'http' => ['method' => 'GET', 'timeout' => $timeout, 'follow_location' => 1, 'user_agent' => ICAL_FETCH_USER_AGENT],
        'ssl' => ['verify_peer' => true],
    ]);
    return @file_get_contents($url, false, $context);
}

$pdo = getPdoSafe();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
logMessage('INFO', 'ical_subscriptions.php branch', ['method' => $method, 'stream' => isset($_GET['stream']), 'preview' => isset($_GET['preview']), 'user_id' => $userId]);

if ($method === 'GET') {
    if (isset($_GET['stream']) && isset($_GET['id'])) {
        logMessage('INFO', 'ical_subscriptions GET stream');
        $id = (int) $_GET['id'];
        if ($id < 1) {
            jsonError('id required');
            exit;
        }
        $stmt = $pdo->prepare('SELECT feed_url FROM ical_subscriptions WHERE id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            jsonError('Subscription not found', 404);
            exit;
        }
        $url = $row['feed_url'];
        $timeout = getIcalFetchTimeout();
        logIcalFetchStart($id, $url, $timeout);
        $raw = icalFetchUrl($url, $timeout);
        if ($raw === false || $raw === '') {
            logIcalFetchFailure($id, 'fetch failed', $url);
            jsonError('Could not open URL for streaming.');
            exit;
        }
        logIcalFetchSuccess($id, strlen($raw), 0);
        header('Content-Type: text/calendar; charset=utf-8');
        header('Cache-Control: no-store');
        while (ob_get_level()) {
            ob_end_flush();
        }
        echo $raw;
        if (ob_get_level()) {
            ob_flush();
        }
        flush();
        logMessage('INFO', 'ical_subscriptions stream ok', ['id' => $id]);
        exit;
    }
    if (isset($_GET['preview']) && isset($_GET['id'])) {
        logMessage('INFO', 'ical_subscriptions GET preview');
        $id = (int) $_GET['id'];
        if ($id < 1) {
            jsonError('id required');
            exit;
        }
        $stmt = $pdo->prepare('SELECT feed_url FROM ical_subscriptions WHERE id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            jsonError('Subscription not found', 404);
            exit;
        }
        $url = $row['feed_url'];
        $timeout = getIcalFetchTimeout();
        logIcalFetchStart($id, $url, $timeout);
        $t0 = microtime(true);
        $raw = icalFetchUrl($url, $timeout);
        $durationMs = (microtime(true) - $t0) * 1000;
        if ($raw === false || $raw === '') {
            logIcalFetchFailure($id, 'empty or fetch failed', $url);
            jsonResponse(['error' => 'Could not fetch the URL. Server may be unreachable or the link may be invalid.']);
            exit;
        }
        logIcalFetchSuccess($id, strlen($raw), $durationMs);
        if (!empty($_GET['download'])) {
            header('Content-Type: text/calendar; charset=utf-8');
            header('Content-Disposition: attachment; filename="feed.ics"');
            echo $raw;
            exit;
        }
        $maxLen = 1024 * 100;
        $truncated = strlen($raw) > $maxLen;
        $content = $truncated ? substr($raw, 0, $maxLen) : $raw;
        $out = ['content' => $content, 'truncated' => $truncated];
        if (!empty($_GET['parse'])) {
            require_once dirname(__DIR__) . '/lib/ical_parser.php';
            $from = isset($_GET['from']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', trim($_GET['from'])) ? trim($_GET['from']) : date('Y-m-d', strtotime('-180 days'));
            $to = isset($_GET['to']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', trim($_GET['to'])) ? trim($_GET['to']) : date('Y-m-d', strtotime('+365 days'));
            $out['parse_range'] = ['from' => $from, 'to' => $to];
            $out['parsed_events'] = parseIcalEvents($raw, $from, $to);
            $out['raw'] = $raw;
        }
        jsonResponse($out);
        exit;
    }
    try {
        $stmt = $pdo->query('SELECT id, feed_url, created_at, COALESCE(enabled, 1) AS enabled FROM ical_subscriptions ORDER BY id');
    } catch (Throwable $e) {
        $stmt = $pdo->query('SELECT id, feed_url, created_at FROM ical_subscriptions ORDER BY id');
    }
    $rows = $stmt ? $stmt->fetchAll(PDO::FETCH_ASSOC) : [];
    foreach ($rows as &$r) {
        $r['enabled'] = !isset($r['enabled']) || (int) $r['enabled'] !== 0;
    }
    unset($r);
    logMessage('INFO', 'ical_subscriptions list ok', ['count' => count($rows)]);
    jsonResponse(['subscriptions' => $rows]);
    exit;
}

if ($method === 'PATCH') {
    logMessage('INFO', 'ical_subscriptions PATCH');
    $in = readJsonInput();
    if (!$in || !isset($in['id']) || !isset($in['enabled'])) {
        jsonError('id and enabled required');
        exit;
    }
    $id = (int) $in['id'];
    $enabled = $in['enabled'] ? 1 : 0;
    if ($id < 1) {
        jsonError('invalid id');
        exit;
    }
    try {
        $pdo->prepare('UPDATE ical_subscriptions SET enabled = ? WHERE id = ?')->execute([$enabled, $id]);
    } catch (Throwable $e) {
        if (strpos($e->getMessage(), 'enabled') !== false) {
            jsonError('Enable/disable not available. Run migrations.');
            exit;
        }
        throw $e;
    }
    logMessage('INFO', 'ical_subscriptions PATCH ok', ['id' => $id]);
    jsonResponse(['ok' => true]);
    exit;
}

if ($method === 'POST') {
    logMessage('INFO', 'ical_subscriptions POST add');
    $in = readJsonInput();
    $url = isset($in['feed_url']) ? trim((string) $in['feed_url']) : '';
    if ($url === '') {
        jsonError('feed_url required');
        exit;
    }
    if (!preg_match('#^https?://#i', $url)) {
        jsonError('feed_url must be http or https');
        exit;
    }
    $timeout = getIcalFetchTimeout();
    logMessage('INFO', 'iCal subscription add: fetch start', ['url' => $url, 'timeout_sec' => $timeout]);
    $t0 = microtime(true);
    $raw = @file_get_contents($url, false, stream_context_create([
        'http' => [
            'method' => 'GET',
            'timeout' => $timeout,
            'follow_location' => 1,
            'user_agent' => ICAL_FETCH_USER_AGENT,
        ],
        'ssl' => ['verify_peer' => true],
    ]));
    $durationMs = (microtime(true) - $t0) * 1000;
    if ($raw === false || $raw === '') {
        logMessage('WARNING', 'iCal subscription add: could not fetch URL', ['feed_url' => $url, 'duration_ms' => round($durationMs, 2)]);
        jsonError('Could not fetch the URL. Check that the link is correct and reachable.');
        exit;
    }
    logMessage('INFO', 'iCal subscription add: fetch success', ['url' => $url, 'bytes_read' => strlen($raw), 'duration_ms' => round($durationMs, 2)]);
    if (stripos($raw, 'BEGIN:VCALENDAR') === false) {
        logError('WARNING', 'iCal subscription add: URL did not return valid iCal (VCALENDAR)', ['feed_url' => $url]);
        jsonError('URL did not return a valid iCal feed (expected VCALENDAR). Check the link or try a different calendar.');
        exit;
    }
    $pdo->prepare('INSERT INTO ical_subscriptions (feed_url) VALUES (?)')->execute([$url]);
    $id = (int) $pdo->lastInsertId();
    jsonResponse(['id' => $id, 'feed_url' => $url], 201);
    exit;
}

if ($method === 'DELETE') {
    $id = isset($_GET['id']) ? (int) $_GET['id'] : 0;
    if ($id < 1) {
        jsonError('id required');
        exit;
    }
    $stmt = $pdo->prepare('DELETE FROM ical_subscriptions WHERE id = ?');
    $stmt->execute([$id]);
    logMessage('INFO', 'ical_subscriptions delete ok', ['id' => $id]);
    jsonResponse(['ok' => true]);
    exit;
}

logMessage('WARNING', 'ical_subscriptions method not allowed', ['method' => $method]);
header('Allow: GET, POST, PATCH, DELETE', true, 405);
exit;
