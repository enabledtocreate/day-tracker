<?php
/**
 * Task list items API: GET by task_id, POST create, PATCH update content or reorder, DELETE.
 */
require_once __DIR__ . '/common.php';
require_once dirname(__DIR__) . '/lib/logger.php';

$pdo = getPdoSafe();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
logMessage('INFO', 'task_list_items.php branch', ['method' => $method, 'user_id' => $userId]);

if ($method === 'GET') {
    $taskId = isset($_GET['task_id']) ? (int) $_GET['task_id'] : 0;
    if ($taskId < 1) {
        logMessage('INFO', 'task_list_items GET task_id missing');
        jsonResponse(['items' => []]);
        exit;
    }
    $stmt = $pdo->prepare("SELECT id, task_id, content, order_index, completed FROM task_list_items WHERE task_id = ? ORDER BY order_index ASC, id ASC");
    $stmt->execute([$taskId]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    logMessage('INFO', 'task_list_items list ok', ['task_id' => $taskId, 'count' => count($rows)]);
    jsonResponse(['items' => $rows]);
    exit;
}

if ($method === 'POST') {
    logMessage('INFO', 'task_list_items POST create');
    $in = readJsonInput();
    if (!$in || empty($in['task_id'])) {
        logMessage('WARNING', 'task_list_items create validation failed');
        jsonError('task_id required');
        exit;
    }
    $taskId = (int) $in['task_id'];
    $content = isset($in['content']) ? trim((string) $in['content']) : '';
    $orderIndex = isset($in['order_index']) ? (int) $in['order_index'] : 0;
    $completed = isset($in['completed']) ? (int) $in['completed'] : 0;
    $stmt = $pdo->prepare("INSERT INTO task_list_items (task_id, content, order_index, completed) VALUES (?, ?, ?, ?)");
    $stmt->execute([$taskId, $content, $orderIndex, $completed ? 1 : 0]);
    $id = (int) $pdo->lastInsertId();
    logMessage('INFO', 'task_list_items create ok', ['id' => $id, 'task_id' => $taskId]);
    jsonResponse(['id' => $id, 'task_id' => $taskId, 'content' => $content, 'order_index' => $orderIndex, 'completed' => $completed ? 1 : 0]);
    exit;
}

if ($method === 'PATCH') {
    logMessage('INFO', 'task_list_items PATCH');
    $in = readJsonInput();
    if (!$in) {
        logMessage('WARNING', 'task_list_items PATCH body required');
        jsonError('Body required');
        exit;
    }
    if (isset($in['order']) && is_array($in['order'])) {
        $taskId = isset($in['task_id']) ? (int) $in['task_id'] : 0;
        if ($taskId < 1) {
            jsonError('task_id required for reorder');
            exit;
        }
        $order = $in['order'];
        $stmt = $pdo->prepare("UPDATE task_list_items SET order_index = ? WHERE id = ? AND task_id = ?");
        foreach ($order as $idx => $id) {
            $stmt->execute([$idx, (int) $id, $taskId]);
        }
        logMessage('INFO', 'task_list_items reorder ok', ['task_id' => $taskId]);
        jsonResponse(['ok' => true]);
        exit;
    }
    $id = isset($in['id']) ? (int) $in['id'] : 0;
    if ($id < 1) {
        logMessage('WARNING', 'task_list_items update id required');
        jsonError('id required');
        exit;
    }
    $updates = [];
    $params = [];
    if (array_key_exists('content', $in)) {
        $updates[] = 'content = ?';
        $params[] = trim((string) $in['content']);
    }
    if (array_key_exists('order_index', $in)) {
        $updates[] = 'order_index = ?';
        $params[] = (int) $in['order_index'];
    }
    if (array_key_exists('completed', $in)) {
        $updates[] = 'completed = ?';
        $params[] = !empty($in['completed']) ? 1 : 0;
    }
    if (empty($updates)) {
        logMessage('WARNING', 'task_list_items update no fields');
        jsonError('No fields to update');
        exit;
    }
    $params[] = $id;
    $pdo->prepare("UPDATE task_list_items SET " . implode(', ', $updates) . " WHERE id = ?")->execute($params);
    logMessage('INFO', 'task_list_items update ok', ['id' => $id]);
    jsonResponse(['ok' => true]);
    exit;
}

if ($method === 'DELETE') {
    logMessage('INFO', 'task_list_items DELETE');
    $id = isset($_GET['id']) ? (int) $_GET['id'] : 0;
    if ($id < 1) {
        logMessage('WARNING', 'task_list_items delete validation failed');
        jsonError('id required');
        exit;
    }
    $pdo->prepare("DELETE FROM task_list_items WHERE id = ?")->execute([$id]);
    logMessage('INFO', 'task_list_items delete ok', ['id' => $id]);
    jsonResponse(['ok' => true]);
    exit;
}

logMessage('WARNING', 'task_list_items method not allowed', ['method' => $method]);
jsonError('Method not allowed', 405);
