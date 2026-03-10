<?php
/**
 * Task links API: GET by task_id, POST add, DELETE.
 */
require_once __DIR__ . '/common.php';
require_once dirname(__DIR__) . '/lib/logger.php';

$pdo = getPdoSafe();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
logMessage('INFO', 'links.php branch', ['method' => $method, 'user_id' => $userId]);

if ($method === 'GET') {
    $taskId = isset($_GET['task_id']) ? (int) $_GET['task_id'] : 0;
    if ($taskId < 1) {
        logMessage('INFO', 'links GET task_id missing');
        jsonResponse(['links' => []]);
        exit;
    }
    $stmt = $pdo->prepare("SELECT id, task_id, url, description FROM task_links WHERE task_id = ? ORDER BY id");
    $stmt->execute([$taskId]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    logMessage('INFO', 'links list ok', ['task_id' => $taskId, 'count' => count($rows)]);
    jsonResponse(['links' => $rows]);
    exit;
}

if ($method === 'POST') {
    logMessage('INFO', 'links POST add');
    $in = readJsonInput();
    if (!$in || empty($in['task_id']) || empty($in['url'])) {
        logMessage('WARNING', 'links add validation failed');
        jsonError('task_id and url required');
        exit;
    }
    $taskId = (int) $in['task_id'];
    $url = trim($in['url']);
    $description = isset($in['description']) ? trim($in['description']) : '';
    $check = $pdo->prepare("SELECT 1 FROM task_links WHERE task_id = ? AND url = ?");
    $check->execute([$taskId, $url]);
    if ($check->fetchColumn()) {
        logMessage('WARNING', 'links add duplicate url', ['task_id' => $taskId]);
        jsonError('url previously added to task', 400);
        exit;
    }
    $stmt = $pdo->prepare("INSERT INTO task_links (task_id, url, description) VALUES (?, ?, ?)");
    $stmt->execute([$taskId, $url, $description]);
    $id = (int) $pdo->lastInsertId();
    logMessage('INFO', 'links add ok', ['id' => $id, 'task_id' => $taskId]);
    jsonResponse(['id' => $id, 'task_id' => $taskId, 'url' => $url, 'description' => $description]);
    exit;
}

if ($method === 'DELETE') {
    logMessage('INFO', 'links DELETE');
    $id = isset($_GET['id']) ? (int) $_GET['id'] : 0;
    if ($id < 1) {
        logMessage('WARNING', 'links delete validation failed');
        jsonError('id required');
        exit;
    }
    $pdo->prepare("DELETE FROM task_links WHERE id = ?")->execute([$id]);
    logMessage('INFO', 'links delete ok', ['id' => $id]);
    jsonResponse(['ok' => true]);
    exit;
}

if ($method === 'PATCH') {
    logMessage('INFO', 'links PATCH update');
    $in = readJsonInput();
    $id = isset($in['id']) ? (int) $in['id'] : 0;
    if ($id < 1) {
        logMessage('WARNING', 'links update validation failed');
        jsonError('id required');
        exit;
    }
    $updates = [];
    $params = [];
    if (array_key_exists('url', $in)) {
        $newUrl = trim($in['url']);
        $row = $pdo->prepare("SELECT task_id FROM task_links WHERE id = ?");
        $row->execute([$id]);
        $link = $row->fetch(PDO::FETCH_ASSOC);
        if ($link) {
            $dup = $pdo->prepare("SELECT 1 FROM task_links WHERE task_id = ? AND url = ? AND id != ?");
            $dup->execute([(int) $link['task_id'], $newUrl, $id]);
            if ($dup->fetchColumn()) {
                logMessage('WARNING', 'links update duplicate url', ['id' => $id]);
                jsonError('url previously added to task', 400);
                exit;
            }
        }
        $updates[] = 'url = ?';
        $params[] = $newUrl;
    }
    if (array_key_exists('description', $in)) {
        $updates[] = 'description = ?';
        $params[] = trim($in['description']);
    }
    if (empty($updates)) {
        logMessage('WARNING', 'links update no fields');
        jsonError('No fields to update');
        exit;
    }
    $params[] = $id;
    $pdo->prepare("UPDATE task_links SET " . implode(', ', $updates) . " WHERE id = ?")->execute($params);
    logMessage('INFO', 'links update ok', ['id' => $id]);
    jsonResponse(['ok' => true]);
    exit;
}

logMessage('WARNING', 'links method not allowed', ['method' => $method]);
jsonError('Method not allowed', 405);
