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
        $stmt = $master->query("SELECT key, value FROM app_settings WHERE key IN ('debug', 'ai_enabled', 'ical_fetch_timeout', 'ical_subscriptions_enabled', 'ical_save_folder', 'ical_save_last_fetch', 'ical_interval_fetch', 'ical_sync_interval_minutes', 'ical_event_range_days', 'ical_omit_uids')");
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
        $folder = getIcalSaveFolder();
        $metaPath = $folder . DIRECTORY_SEPARATOR . 'last_fetch.json';
        $out = ['path' => null, 'content' => null, 'subscription_id' => null, 'saved_at' => null, 'save_folder' => $folder, 'sync_state' => null, 'parsed_events' => null, 'parse_range' => null];
        if (is_file($metaPath)) {
            $meta = @json_decode((string) file_get_contents($metaPath), true);
            if (is_array($meta)) {
                $out['sync_state'] = $meta;
                $out['subscription_id'] = isset($meta['subscription_id']) ? (int) $meta['subscription_id'] : null;
                $out['saved_at'] = $meta['saved_at'] ?? null;
                if (!empty($meta['path']) && is_file($meta['path'])) {
                    $out['path'] = $meta['path'];
                    $out['content'] = file_get_contents($meta['path']);
                    $from = $meta['range_from'] ?? $meta['saved_at'] ? substr($meta['saved_at'], 0, 10) : gmdate('Y-m-d');
                    $to = $meta['range_to'] ?? gmdate('Y-m-d', strtotime('+1 year'));
                    if (is_string($out['content']) && $out['content'] !== '') {
                        try {
                            $out['parsed_events'] = parseIcalEvents($out['content'], $from, $to);
                            $out['parse_range'] = ['from' => $from, 'to' => $to];
                        } catch (Throwable $e) {
                            $out['parsed_events'] = [];
                        }
                    }
                }
            }
        }
        logMessage('INFO', 'admin ical_last_fetch ok', ['has_sync_state' => $out['sync_state'] !== null]);
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
        logMessage('INFO', 'admin PATCH ical_subscriptions_enabled ok');
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
