<?php
/**
 * Admin-only database diagnostics (does not require user DB to be open).
 */
require_once dirname(__DIR__) . '/lib/auth.php';
require_once dirname(__DIR__) . '/lib/db.php';
require_once dirname(__DIR__) . '/lib/logger.php';

requireAuth();
if (!isAdmin()) {
    http_response_code(403);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Forbidden']);
    exit;
}

$root = dirname(__DIR__);
$configPath = $root . '/config.php';
$user = getCurrentUser();
$status = [
    'config_file' => is_file($configPath),
    'data_dir' => null,
    'data_dir_exists' => false,
    'data_dir_writable' => false,
    'master_db_exists' => false,
    'user_db_name' => $user['db_name'] ?? null,
    'user_db_exists' => false,
    'pdo' => null,
    'pdo_error' => null,
];

try {
    $dataDir = getDataDir();
    $status['data_dir'] = $dataDir;
    $status['data_dir_exists'] = is_dir($dataDir);
    $status['data_dir_writable'] = is_dir($dataDir) && is_writable($dataDir);
    $status['master_db_exists'] = is_file(getMasterDbPath());
    if (!empty($user['db_name'])) {
        $userDbPath = $dataDir . '/' . $user['db_name'];
        $status['user_db_exists'] = is_file($userDbPath);
    }
    try {
        getPdo();
        $status['pdo'] = 'ok';
    } catch (Throwable $e) {
        $status['pdo_error'] = $e->getMessage();
    }
} catch (Throwable $e) {
    $status['bootstrap_error'] = $e->getMessage();
}

http_response_code(200);
header('Content-Type: application/json; charset=utf-8');
echo json_encode($status);
