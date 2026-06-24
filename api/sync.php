<?php
/**
 * Lightweight sync endpoint for multi-device polling.
 * GET returns monotonic data_revision (bumped by DB triggers on writes).
 */
require_once __DIR__ . '/common.php';
require_once dirname(__DIR__) . '/lib/data_revision.php';

$pdo = getPdoSafe();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method !== 'GET') {
    jsonError('Method not allowed', 405);
    exit;
}

$revision = dt_get_data_revision($pdo);
$out = [
    'revision' => $revision,
    'server_time' => date('c'),
];

if (dt_table_has_column($pdo, 'tasks', 'updated_at')) {
    $out['tasks_updated_at'] = $pdo->query('SELECT MAX(updated_at) FROM tasks')->fetchColumn() ?: null;
}
if (dt_table_has_column($pdo, 'scheduled_slots', 'updated_at')) {
    $out['slots_updated_at'] = $pdo->query('SELECT MAX(updated_at) FROM scheduled_slots')->fetchColumn() ?: null;
}

jsonResponse($out);
