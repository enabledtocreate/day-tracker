<?php
/**
 * Favorite folders: named groups for Favorites (is_common tasks).
 * GET: list. POST: create { name }. PATCH: { id, name?, sort_order? }. DELETE: ?id=
 */
require_once __DIR__ . '/common.php';
require_once dirname(__DIR__) . '/lib/logger.php';

$pdo = getPdoSafe();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
logMessage('INFO', 'favorite_folders.php', ['method' => $method, 'user_id' => $userId]);

$tableOk = $pdo->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='favorite_folder'")->fetchColumn();
if (!$tableOk) {
    if ($method === 'GET') {
        jsonResponse(['folders' => []]);
        exit;
    }
    jsonError('Favorite folders require migration 029_favorite_folders.sql', 503);
    exit;
}

if ($method === 'GET') {
    $rows = $pdo->query('SELECT id, name, sort_order FROM favorite_folder ORDER BY sort_order ASC, id ASC')->fetchAll(PDO::FETCH_ASSOC);
    jsonResponse(['folders' => $rows]);
    exit;
}

if ($method === 'POST') {
    $in = readJsonInput();
    if (!$in) {
        jsonError('Invalid JSON');
        exit;
    }
    $name = isset($in['name']) ? trim((string) $in['name']) : '';
    if ($name === '') {
        jsonError('name required');
        exit;
    }
    $maxStmt = $pdo->query('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM favorite_folder');
    $sort = (int) ($maxStmt ? $maxStmt->fetchColumn() : 0);
    $pdo->prepare('INSERT INTO favorite_folder (name, sort_order) VALUES (?, ?)')->execute([$name, $sort]);
    $id = (int) $pdo->lastInsertId();
    jsonResponse(['id' => $id, 'name' => $name, 'sort_order' => $sort]);
    exit;
}

if ($method === 'PATCH') {
    $in = readJsonInput();
    if (!$in) {
        jsonError('Invalid JSON');
        exit;
    }
    $id = isset($in['id']) ? (int) $in['id'] : 0;
    if ($id < 1) {
        jsonError('id required');
        exit;
    }
    $updates = [];
    $params = [];
    if (array_key_exists('name', $in)) {
        $n = trim((string) $in['name']);
        if ($n === '') {
            jsonError('name cannot be empty');
            exit;
        }
        $updates[] = 'name = ?';
        $params[] = $n;
    }
    if (array_key_exists('sort_order', $in)) {
        $updates[] = 'sort_order = ?';
        $params[] = (int) $in['sort_order'];
    }
    if (empty($updates)) {
        jsonError('No fields to update');
        exit;
    }
    $params[] = $id;
    $pdo->prepare('UPDATE favorite_folder SET ' . implode(', ', $updates) . ' WHERE id = ?')->execute($params);
    $row = $pdo->prepare('SELECT id, name, sort_order FROM favorite_folder WHERE id = ?');
    $row->execute([$id]);
    $out = $row->fetch(PDO::FETCH_ASSOC);
    jsonResponse(['ok' => true, 'folder' => $out]);
    exit;
}

if ($method === 'DELETE') {
    $id = isset($_GET['id']) ? (int) $_GET['id'] : 0;
    if ($id < 1) {
        jsonError('id required');
        exit;
    }
    $pdo->prepare('DELETE FROM favorite_folder WHERE id = ?')->execute([$id]);
    jsonResponse(['ok' => true]);
    exit;
}

jsonError('Method not allowed', 405);
