<?php
/**
 * iCal excluded events: GET list (uid + title), POST add (admin, stores title), PATCH remove one (add back).
 * Uses master DB for ical_omit_uids and ical_excluded_events table.
 */
require_once __DIR__ . '/common.php';
require_once dirname(__DIR__) . '/lib/logger.php';

$master = getMasterPdo();

// Create table for titles if not exists (master DB)
$master->exec("CREATE TABLE IF NOT EXISTS ical_excluded_events (uid TEXT NOT NULL PRIMARY KEY, title TEXT NOT NULL DEFAULT '')");

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    $stmt = $master->query("SELECT uid, title FROM ical_excluded_events ORDER BY title, uid");
    $rows = $stmt ? $stmt->fetchAll(PDO::FETCH_ASSOC) : [];
    $list = array_map(function ($r) {
        return ['uid' => $r['uid'], 'title' => $r['title'] ?? ''];
    }, $rows);
    jsonResponse(['excluded' => $list]);
    exit;
}

if ($method === 'POST') {
    $in = readJsonInput();
    $uid = isset($in['uid']) ? trim((string) $in['uid']) : '';
    $title = isset($in['title']) ? trim((string) $in['title']) : '';
    if ($uid === '') {
        jsonError('uid required');
        exit;
    }
    $stmt = $master->query("SELECT value FROM app_settings WHERE key = 'ical_omit_uids'");
    $row = $stmt ? $stmt->fetch(PDO::FETCH_ASSOC) : false;
    $raw = $row ? trim((string) $row['value']) : '';
    $uids = $raw === '' ? [] : array_values(array_filter(array_map('trim', preg_split('/[\r\n,]+/', $raw, -1, PREG_SPLIT_NO_EMPTY))));
    if (!in_array($uid, $uids, true)) {
        $uids[] = $uid;
    }
    $master->prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)")->execute(['ical_omit_uids', implode("\n", $uids)]);
    $master->prepare("INSERT OR REPLACE INTO ical_excluded_events (uid, title) VALUES (?, ?)")->execute([$uid, $title]);
    logMessage('INFO', 'ical_excluded.php POST', ['uid' => $uid]);
    jsonResponse(['ok' => true]);
    exit;
}

if ($method === 'PATCH') {
    $in = readJsonInput();
    $removeUid = isset($in['remove_uid']) ? trim((string) $in['remove_uid']) : '';
    if ($removeUid === '') {
        jsonError('remove_uid required');
        exit;
    }
    $stmt = $master->query("SELECT value FROM app_settings WHERE key = 'ical_omit_uids'");
    $row = $stmt ? $stmt->fetch(PDO::FETCH_ASSOC) : false;
    $raw = $row ? trim((string) $row['value']) : '';
    $uids = $raw === '' ? [] : array_values(array_filter(array_map('trim', preg_split('/[\r\n,]+/', $raw, -1, PREG_SPLIT_NO_EMPTY))));
    $uids = array_values(array_filter($uids, function ($u) use ($removeUid) {
        return $u !== $removeUid;
    }));
    $master->prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)")->execute(['ical_omit_uids', implode("\n", $uids)]);
    $master->prepare("DELETE FROM ical_excluded_events WHERE uid = ?")->execute([$removeUid]);
    logMessage('INFO', 'ical_excluded.php PATCH remove', ['uid' => $removeUid]);
    jsonResponse(['ok' => true]);
    exit;
}

jsonError('Method not allowed', 405);
