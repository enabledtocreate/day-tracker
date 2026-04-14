<?php
/**
 * Admin-only: app settings (debug, ai_enabled), list users, set force_password_reset, error log.
 */
require_once __DIR__ . '/common.php';
require_once dirname(__DIR__) . '/lib/logger.php';

if (!isAdmin()) {
    logMessage('WARNING', 'admin forbidden', ['user_id' => isset($user['id']) ? (int) $user['id'] : null]);
    jsonError('Forbidden', 403);
    exit;
}

$master = getMasterPdo();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
logMessage('INFO', 'admin.php branch', ['method' => $method, 'action' => $_GET['action'] ?? null]);

if ($method === 'GET') {
    $action = $_GET['action'] ?? 'settings';
    if ($action === 'settings') {
        logMessage('INFO', 'admin action settings');
        $stmt = $master->query("SELECT key, value FROM app_settings WHERE key IN ('debug', 'ai_enabled', 'ical_fetch_timeout', 'ical_subscriptions_enabled', 'ical_save_folder', 'ical_save_last_fetch', 'ical_interval_fetch', 'ical_sync_interval_minutes', 'ical_event_range_days', 'ical_omit_uids', 'ical_use_cron_job')");
        $settings = [
            'debug' => false,
            'ai_enabled' => true,
            'ical_fetch_timeout' => 60,
            'ical_subscriptions_enabled' => true,
            'ical_save_folder' => '',
            'ical_save_last_fetch' => false,
            'ical_interval_fetch' => true,
            'ical_sync_interval_minutes' => 15,
            'ical_event_range_days' => 365,
            'ical_omit_uids' => '',
            'ical_use_cron_job' => false,
        ];
        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            if ($row['key'] === 'debug') {
                $settings['debug'] = ($row['value'] === '1');
            } elseif ($row['key'] === 'ai_enabled') {
                $settings['ai_enabled'] = ($row['value'] !== '0');
            } elseif ($row['key'] === 'ical_fetch_timeout') {
                $v = (int) $row['value'];
                $settings['ical_fetch_timeout'] = $v > 0 ? max(5, min(300, $v)) : 60;
            } elseif ($row['key'] === 'ical_subscriptions_enabled') {
                $settings['ical_subscriptions_enabled'] = ($row['value'] !== '0');
            } elseif ($row['key'] === 'ical_save_folder') {
                $settings['ical_save_folder'] = trim((string) $row['value']);
            } elseif ($row['key'] === 'ical_save_last_fetch') {
                $settings['ical_save_last_fetch'] = ($row['value'] === '1');
            } elseif ($row['key'] === 'ical_interval_fetch') {
                $settings['ical_interval_fetch'] = ($row['value'] !== '0' && $row['value'] !== '');
            } elseif ($row['key'] === 'ical_sync_interval_minutes') {
                $v = (int) $row['value'];
                $settings['ical_sync_interval_minutes'] = $v > 0 ? max(1, min(120, $v)) : 15;
            } elseif ($row['key'] === 'ical_event_range_days') {
                $v = (int) $row['value'];
                $settings['ical_event_range_days'] = $v > 0 ? max(1, min(732, $v)) : 365;
            } elseif ($row['key'] === 'ical_omit_uids') {
                $settings['ical_omit_uids'] = trim((string) $row['value']);
            } elseif ($row['key'] === 'ical_use_cron_job') {
                $settings['ical_use_cron_job'] = ($row['value'] === '1');
            }
        }
        require_once dirname(__DIR__) . '/lib/db.php';
        $fullFolder = getIcalSaveFolder();
        $dataDir = rtrim(getDataDir(), DIRECTORY_SEPARATOR . '/\\');
        $settings['ical_save_folder_local'] = (strpos($fullFolder, $dataDir) === 0)
            ? ltrim(substr($fullFolder, strlen($dataDir)), DIRECTORY_SEPARATOR . '/\\')
            : basename($fullFolder);
        if ($settings['ical_save_folder'] === '') {
            $settings['ical_save_folder'] = $settings['ical_save_folder_local'];
        }
        logMessage('INFO', 'admin settings ok', ['user_id' => $userId]);
        jsonResponse($settings);
        exit;
    }
    if ($action === 'users') {
        logMessage('INFO', 'admin action users');
        $stmt = $master->query('SELECT id, username, db_name, force_password_reset, is_admin, created_at FROM users ORDER BY username');
        $users = [];
        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $users[] = [
                'id' => (int) $row['id'],
                'username' => $row['username'],
                'db_name' => $row['db_name'],
                'force_password_reset' => (bool) $row['force_password_reset'],
                'is_admin' => (bool) $row['is_admin'],
                'created_at' => $row['created_at'],
                'sso_providers' => [],
            ];
        }
        $stmt = $master->query('SELECT master_user_id, provider FROM sso_accounts');
        $ssoByUser = [];
        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $uid = (int) $row['master_user_id'];
            if (!isset($ssoByUser[$uid])) $ssoByUser[$uid] = [];
            $ssoByUser[$uid][] = $row['provider'];
        }
        foreach ($users as &$u) {
            $u['sso_providers'] = $ssoByUser[$u['id']] ?? [];
        }
        logMessage('INFO', 'admin users ok', ['count' => count($users)]);
        jsonResponse(['users' => $users]);
        exit;
    }
    if ($action === 'error_log') {
        logMessage('INFO', 'admin action error_log');
        $lines = readErrorLogTail(2000, 512 * 1024);
        logMessage('INFO', 'admin error_log ok', ['lines' => count($lines)]);
        jsonResponse(['lines' => $lines]);
        exit;
    }
    if ($action === 'ical_last_fetch') {
        logMessage('INFO', 'admin action ical_last_fetch');
        require_once dirname(__DIR__) . '/lib/db.php';
        require_once dirname(__DIR__) . '/lib/ical_parser.php';
        require_once dirname(__DIR__) . '/lib/ical_subscription_sync.php';
        $folder = getIcalSaveFolder();
        $pdo = getPdo();
        icalSubscriptionSyncStatusEnsureTable($pdo);
        $today = gmdate('Y-m-d');
        $rangeDays = getIcalEventRangeDays();
        $toDateDefault = gmdate('Y-m-d', strtotime('+' . $rangeDays . ' days'));
        $subscriptions = [];
        try {
            $stmt = $pdo->query(
                'SELECT s.id AS subscription_id, s.feed_url, st.sync_state, st.message, st.error, st.bytes_fetched, st.parsed_count, st.range_from, st.range_to, st.fetch_file_path, st.updated_at
                FROM ical_subscriptions s
                LEFT JOIN ical_subscription_sync_status st ON st.subscription_id = s.id
                WHERE COALESCE(s.enabled, 1) = 1
                ORDER BY s.id'
            );
            $rows = $stmt ? $stmt->fetchAll(PDO::FETCH_ASSOC) : [];
        } catch (Throwable $e) {
            logMessage('NOTICE', 'admin ical_last_fetch subscriptions query', ['message' => $e->getMessage()]);
            $rows = [];
        }
        foreach ($rows as $row) {
            $sid = (int) $row['subscription_id'];
            $path = isset($row['fetch_file_path']) ? trim((string) $row['fetch_file_path']) : '';
            $content = null;
            $parsed_events = null;
            $fromParse = $row['range_from'] ? trim((string) $row['range_from']) : $today;
            $toParse = $row['range_to'] ? trim((string) $row['range_to']) : $toDateDefault;
            if ($path !== '' && is_file($path)) {
                $content = @file_get_contents($path);
                if (is_string($content) && $content !== '') {
                    try {
                        $parsed_events = parseIcalEvents($content, $fromParse, $toParse);
                    } catch (Throwable $e) {
                        logError('WARNING', 'admin ical_last_fetch parseIcalEvents failed', [
                            'subscription_id' => $sid,
                            'message' => $e->getMessage(),
                        ]);
                        $parsed_events = [];
                    }
                }
            }
            $subscriptions[] = [
                'subscription_id' => $sid,
                'feed_url' => $row['feed_url'] ?? null,
                'sync_state' => $row['sync_state'] ?? null,
                'message' => $row['message'] ?? null,
                'error' => $row['error'] ?? null,
                'bytes_fetched' => isset($row['bytes_fetched']) && $row['bytes_fetched'] !== null && $row['bytes_fetched'] !== '' ? (int) $row['bytes_fetched'] : null,
                'parsed_count' => isset($row['parsed_count']) && $row['parsed_count'] !== null && $row['parsed_count'] !== '' ? (int) $row['parsed_count'] : null,
                'range_from' => $row['range_from'] ?? null,
                'range_to' => $row['range_to'] ?? null,
                'updated_at' => $row['updated_at'] ?? null,
                'path' => ($path !== '' && is_file($path)) ? $path : null,
                'content' => is_string($content) ? $content : null,
                'parsed_events' => $parsed_events,
                'parse_range' => ['from' => $fromParse, 'to' => $toParse],
            ];
        }
        $primary = null;
        foreach ($subscriptions as $s) {
            if (!empty($s['content'])) {
                $primary = $s;
                break;
            }
        }
        if ($primary === null && $subscriptions !== []) {
            $primary = $subscriptions[0];
        }
        $out = [
            'save_folder' => $folder,
            'subscriptions' => $subscriptions,
            'path' => $primary['path'] ?? null,
            'content' => $primary['content'] ?? null,
            'subscription_id' => $primary['subscription_id'] ?? null,
            'saved_at' => $primary['updated_at'] ?? null,
            'sync_state' => null,
            'parsed_events' => $primary['parsed_events'] ?? null,
            'parse_range' => $primary['parse_range'] ?? null,
        ];
        if ($primary !== null) {
            $out['sync_state'] = array_filter([
                'state' => $primary['sync_state'],
                'subscription_id' => $primary['subscription_id'],
                'feed_url' => $primary['feed_url'],
                'range_from' => $primary['range_from'],
                'range_to' => $primary['range_to'],
                'parsed_count' => $primary['parsed_count'],
                'bytes_fetched' => $primary['bytes_fetched'],
                'updated_at' => $primary['updated_at'],
                'message' => $primary['message'],
                'error' => $primary['error'],
            ], static function ($v) {
                return $v !== null && $v !== '';
            });
        }
        logMessage('INFO', 'admin ical_last_fetch ok', ['subscriptions' => count($subscriptions)]);
        jsonResponse($out);
        exit;
    }
}

if ($method === 'PATCH' || $method === 'POST') {
    $in = readJsonInput();
    if (!$in) $in = [];

    if (isset($in['debug'])) {
        $v = $in['debug'] ? '1' : '0';
        $master->prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)')->execute(['debug', $v]);
        logMessage('INFO', 'admin PATCH debug ok', ['value' => (bool) $in['debug']]);
        jsonResponse(['ok' => true]);
        exit;
    }
    if (isset($in['ai_enabled'])) {
        $v = $in['ai_enabled'] ? '1' : '0';
        $master->prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)')->execute(['ai_enabled', $v]);
        logMessage('INFO', 'admin PATCH ai_enabled ok');
        jsonResponse(['ok' => true]);
        exit;
    }
    if (isset($in['ical_fetch_timeout']) && is_numeric($in['ical_fetch_timeout'])) {
        $v = max(5, min(300, (int) $in['ical_fetch_timeout']));
        $master->prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)')->execute(['ical_fetch_timeout', (string) $v]);
        logMessage('INFO', 'admin PATCH ical_fetch_timeout ok', ['value' => $v]);
        jsonResponse(['ok' => true]);
        exit;
    }
    if (isset($in['ical_subscriptions_enabled'])) {
        $v = $in['ical_subscriptions_enabled'] ? '1' : '0';
        $master->prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)')->execute(['ical_subscriptions_enabled', $v]);
        if ($v === '0') {
            $upd = $master->prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)');
            $upd->execute(['ical_use_cron_job', '0']);
            $upd->execute(['ical_interval_fetch', '0']);
            logMessage('INFO', 'admin PATCH ical_subscriptions_enabled off: cleared cron job mode and browser interval fetch');
        }
        logMessage('INFO', 'admin PATCH ical_subscriptions_enabled ok');
        jsonResponse(['ok' => true]);
        exit;
    }
    if (isset($in['ical_fetch_trigger'])) {
        $t = (string) $in['ical_fetch_trigger'];
        if ($t === 'server_cron') {
            $upd = $master->prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)');
            $upd->execute(['ical_use_cron_job', '1']);
            $upd->execute(['ical_interval_fetch', '0']);
            logMessage('INFO', 'admin PATCH ical_fetch_trigger', ['mode' => 'server_cron']);
        } elseif ($t === 'browser_interval') {
            $upd = $master->prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)');
            $upd->execute(['ical_use_cron_job', '0']);
            $upd->execute(['ical_interval_fetch', '1']);
            logMessage('INFO', 'admin PATCH ical_fetch_trigger', ['mode' => 'browser_interval']);
        } else {
            jsonError('ical_fetch_trigger must be browser_interval or server_cron', 400);
            exit;
        }
        jsonResponse(['ok' => true]);
        exit;
    }
    if (array_key_exists('ical_save_folder', $in)) {
        $v = is_string($in['ical_save_folder']) ? trim($in['ical_save_folder']) : '';
        if (strpos($v, '..') !== false || ($v !== '' && ($v[0] === '/' || $v[0] === '\\'))) {
            $v = 'ical_fetches';
        }
        $v = trim(preg_replace('#[/\\\\]+#', '/', $v), '/');
        if ($v === '') {
            $v = 'ical_fetches';
        }
        $master->prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)')->execute(['ical_save_folder', $v]);
        logMessage('INFO', 'admin PATCH ical_save_folder ok', ['value' => $v]);
        jsonResponse(['ok' => true]);
        exit;
    }
    if (isset($in['ical_save_last_fetch'])) {
        $v = ($in['ical_save_last_fetch'] === true || $in['ical_save_last_fetch'] === '1' || $in['ical_save_last_fetch'] === 1) ? '1' : '0';
        $master->prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)')->execute(['ical_save_last_fetch', $v]);
        if ($v === '0') {
            require_once dirname(__DIR__) . '/lib/db.php';
            $folder = getIcalSaveFolder();
            foreach (glob($folder . DIRECTORY_SEPARATOR . '*.ics') ?: [] as $path) {
                if (is_file($path)) {
                    @unlink($path);
                    logMessage('INFO', 'admin ical save_last_fetch off: deleted file', ['path' => $path]);
                }
            }
        }
        logMessage('INFO', 'admin PATCH ical_save_last_fetch ok');
        jsonResponse(['ok' => true]);
        exit;
    }
    if (isset($in['ical_interval_fetch'])) {
        $v = ($in['ical_interval_fetch'] === true || $in['ical_interval_fetch'] === '1' || $in['ical_interval_fetch'] === 1) ? '1' : '0';
        $master->prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)')->execute(['ical_interval_fetch', $v]);
        logMessage('INFO', 'admin PATCH ical_interval_fetch ok');
        jsonResponse(['ok' => true]);
        exit;
    }
    if (isset($in['ical_use_cron_job'])) {
        $v = ($in['ical_use_cron_job'] === true || $in['ical_use_cron_job'] === '1' || $in['ical_use_cron_job'] === 1) ? '1' : '0';
        $master->prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)')->execute(['ical_use_cron_job', $v]);
        logMessage('INFO', 'admin PATCH ical_use_cron_job ok', ['value' => $v === '1']);
        jsonResponse(['ok' => true]);
        exit;
    }
    if (isset($in['ical_sync_interval_minutes']) && is_numeric($in['ical_sync_interval_minutes'])) {
        $v = max(1, min(120, (int) $in['ical_sync_interval_minutes']));
        $master->prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)')->execute(['ical_sync_interval_minutes', (string) $v]);
        logMessage('INFO', 'admin PATCH ical_sync_interval_minutes ok', ['value' => $v]);
        jsonResponse(['ok' => true]);
        exit;
    }
    if (isset($in['ical_event_range_days']) && is_numeric($in['ical_event_range_days'])) {
        $v = max(1, min(732, (int) $in['ical_event_range_days']));
        $master->prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)')->execute(['ical_event_range_days', (string) $v]);
        logMessage('INFO', 'admin PATCH ical_event_range_days ok', ['value' => $v]);
        jsonResponse(['ok' => true]);
        exit;
    }
    if (array_key_exists('ical_omit_uids', $in)) {
        $v = is_string($in['ical_omit_uids']) ? trim($in['ical_omit_uids']) : '';
        $master->prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)')->execute(['ical_omit_uids', $v]);
        logMessage('INFO', 'admin PATCH ical_omit_uids ok');
        jsonResponse(['ok' => true]);
        exit;
    }
    if (isset($in['clear_ical_feed_events']) && $in['clear_ical_feed_events']) {
        $stmt = $master->query("SELECT value FROM app_settings WHERE key = 'debug'");
        $row = $stmt ? $stmt->fetch(PDO::FETCH_ASSOC) : null;
        if (!$row || $row['value'] !== '1') {
            logMessage('WARNING', 'admin clear_ical_feed_events refused (debug off)');
            jsonError('Clear iCal feed events is only allowed when debug is on', 403);
            exit;
        }
        require_once dirname(__DIR__) . '/lib/db.php';
        $pdo = getPdo();
        $deleted = $pdo->exec('DELETE FROM ical_feed_events');
        logMessage('INFO', 'admin clear_ical_feed_events ok', ['deleted' => (int) $deleted]);
        jsonResponse(['ok' => true, 'deleted' => (int) $deleted]);
        exit;
    }
    if (isset($in['force_password_reset']) && isset($in['user_id'])) {
        $userId = (int) $in['user_id'];
        $val = $in['force_password_reset'] ? 1 : 0;
        $stmt = $master->prepare('SELECT id FROM users WHERE id = ?');
        $stmt->execute([$userId]);
        if (!$stmt->fetch()) {
            logMessage('WARNING', 'admin PATCH force_password_reset user not found', ['user_id' => $userId]);
            jsonError('User not found', 404);
            exit;
        }
        $master->prepare('UPDATE users SET force_password_reset = ? WHERE id = ?')->execute([$val, $userId]);
        logMessage('INFO', 'admin PATCH force_password_reset ok', ['user_id' => $userId, 'value' => (bool) $val]);
        jsonResponse(['ok' => true]);
        exit;
    }
}

logMessage('WARNING', 'admin bad request', ['method' => $method]);
jsonError('Bad request', 400);
