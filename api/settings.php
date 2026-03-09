<?php
/**
 * App settings API: GET (time view: start_hour, end_hour, increment_value, increment_unit), PATCH.
 */
require_once __DIR__ . '/common.php';
require_once dirname(__DIR__) . '/lib/logger.php';

$pdo = getPdoSafe();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
logMessage('INFO', 'settings.php branch', ['method' => $method, 'user_id' => $userId]);

$keys = ['start_hour', 'end_hour', 'increment_value', 'increment_unit', 'timezone'];

if ($method === 'GET') {
    logMessage('INFO', 'settings GET');
    $stmt = $pdo->query("SELECT key, value FROM app_settings WHERE key IN ('start_hour','end_hour','increment_value','increment_unit','timezone')");
    $rows = $stmt ? $stmt->fetchAll(PDO::FETCH_KEY_PAIR) : [];
    $settings = [
        'start_hour' => (int) ($rows['start_hour'] ?? 6),
        'end_hour' => (int) ($rows['end_hour'] ?? 23),
        'increment_value' => (int) ($rows['increment_value'] ?? 15),
        'increment_unit' => $rows['increment_unit'] ?? 'min',
        'timezone' => isset($rows['timezone']) ? (string) $rows['timezone'] : '',
    ];
    if ($settings['increment_unit'] !== 'min' && $settings['increment_unit'] !== 'hr') {
        $settings['increment_unit'] = 'min';
    }
    logMessage('INFO', 'settings GET ok');
    jsonResponse($settings);
    exit;
}

if ($method === 'PATCH') {
    logMessage('INFO', 'settings PATCH');
    $in = readJsonInput();
    if (!$in || !is_array($in)) {
        logMessage('WARNING', 'settings PATCH body required');
        jsonError('JSON body required');
        exit;
    }
    $stmt = $pdo->prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    foreach ($keys as $key) {
        if (!array_key_exists($key, $in)) {
            continue;
        }
        $v = $in[$key];
        if ($key === 'timezone') {
            $v = is_string($v) ? trim($v) : '';
        } elseif ($key === 'increment_unit') {
            $v = ($v === 'hr' || $v === 'min') ? $v : 'min';
        } else {
            $v = (string) (int) $v;
        }
        $stmt->execute([$key, $v]);
    }
    logMessage('INFO', 'settings PATCH ok');
    jsonResponse(['ok' => true]);
    exit;
}

logMessage('WARNING', 'settings method not allowed', ['method' => $method]);
jsonError('Method not allowed', 405);
