<?php
/**
 * Debug API: clear tasks, reset everything.
 */
require_once __DIR__ . '/common.php';

$pdo = getPdoSafe();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method !== 'POST') {
    jsonError('Method not allowed', 405);
    exit;
}

$in = readJsonInput();
$action = $in['action'] ?? '';

if ($action === 'clear_tasks') {
    $pdo->exec("DELETE FROM scheduled_slots");
    $pdo->exec("DELETE FROM task_links");
    $pdo->exec("DELETE FROM tasks");
    jsonResponse(['ok' => true]);
    exit;
}

if ($action === 'reset_all') {
    $pdo->exec("DELETE FROM scheduled_slots");
    $pdo->exec("DELETE FROM task_links");
    $pdo->exec("DELETE FROM tasks");
    $pdo->exec("DELETE FROM day_record");
    $pdo->exec("DELETE FROM app_settings");
    jsonResponse(['ok' => true]);
    exit;
}

jsonError('Unknown action: ' . $action);
