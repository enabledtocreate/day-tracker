<?php
/**
 * AI conversation threads: separate *_ai.sqlite per user.
 *
 * GET  — list threads (newest first) or ?id=N for thread + messages
 * POST — JSON { action: "create", title? } | { action: "append", thread_id, role, payload }
 * DELETE — ?id=N delete thread and messages
 */
declare(strict_types=1);

require_once dirname(__DIR__) . '/common.php';
require_once dirname(__DIR__, 2) . '/lib/db.php';

header('Content-Type: application/json; charset=utf-8');

const AI_USER_PAYLOAD_MAX = 32768;
const AI_ASSISTANT_PAYLOAD_MAX = 131072;

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$pdo = getAiPdoSafe();

if ($method === 'GET') {
    $id = isset($_GET['id']) ? (int) $_GET['id'] : 0;
    if ($id > 0) {
        $st = $pdo->prepare('SELECT id, created_at, updated_at, title FROM ai_threads WHERE id = ?');
        $st->execute([$id]);
        $thread = $st->fetch(PDO::FETCH_ASSOC);
        if (!$thread) {
            jsonError('Thread not found', 404);
            exit;
        }
        $ms = $pdo->prepare('SELECT id, thread_id, role, created_at, payload_json FROM ai_messages WHERE thread_id = ? ORDER BY id ASC');
        $ms->execute([$id]);
        $rows = $ms->fetchAll(PDO::FETCH_ASSOC);
        jsonResponse(['thread' => $thread, 'messages' => $rows]);
        exit;
    }
    $list = $pdo->query('SELECT id, created_at, updated_at, title FROM ai_threads ORDER BY updated_at DESC, id DESC LIMIT 50');
    $threads = $list ? $list->fetchAll(PDO::FETCH_ASSOC) : [];
    jsonResponse(['threads' => $threads]);
    exit;
}

if ($method === 'DELETE') {
    $id = isset($_GET['id']) ? (int) $_GET['id'] : 0;
    if ($id < 1) {
        jsonError('id required');
        exit;
    }
    $del = $pdo->prepare('DELETE FROM ai_threads WHERE id = ?');
    $del->execute([$id]);
    jsonResponse(['ok' => true, 'deleted' => $del->rowCount()]);
    exit;
}

if ($method !== 'POST') {
    jsonError('Method not allowed', 405);
    exit;
}

$input = readJsonInput();
if (!$input || !isset($input['action'])) {
    jsonError('action required');
    exit;
}

$action = (string) $input['action'];

if ($action === 'create') {
    $title = isset($input['title']) ? trim((string) $input['title']) : null;
    if ($title === '') {
        $title = null;
    }
    if ($title !== null && strlen($title) > 200) {
        $title = substr($title, 0, 200);
    }
    $pdo->prepare('INSERT INTO ai_threads (title) VALUES (?)')->execute([$title]);
    $tid = (int) $pdo->lastInsertId();
    $st = $pdo->prepare('SELECT id, created_at, updated_at, title FROM ai_threads WHERE id = ?');
    $st->execute([$tid]);
    $thread = $st->fetch(PDO::FETCH_ASSOC);
    jsonResponse(['thread' => $thread]);
    exit;
}

if ($action === 'append') {
    $threadId = isset($input['thread_id']) ? (int) $input['thread_id'] : 0;
    $role = isset($input['role']) ? trim((string) $input['role']) : '';
    if ($threadId < 1 || !in_array($role, ['user', 'assistant'], true)) {
        jsonError('thread_id and role (user|assistant) required');
        exit;
    }
    $chk = $pdo->prepare('SELECT 1 FROM ai_threads WHERE id = ?');
    $chk->execute([$threadId]);
    if (!$chk->fetch()) {
        jsonError('Thread not found', 404);
        exit;
    }
    $payload = $input['payload'] ?? null;
    if (!is_array($payload)) {
        jsonError('payload object required');
        exit;
    }
    $json = json_encode($payload, JSON_UNESCAPED_UNICODE);
    if ($json === false) {
        jsonError('Invalid payload');
        exit;
    }
    $max = $role === 'user' ? AI_USER_PAYLOAD_MAX : AI_ASSISTANT_PAYLOAD_MAX;
    if (strlen($json) > $max) {
        jsonError('Payload too large', 413);
        exit;
    }
    $ins = $pdo->prepare('INSERT INTO ai_messages (thread_id, role, payload_json) VALUES (?, ?, ?)');
    $ins->execute([$threadId, $role, $json]);
    $mid = (int) $pdo->lastInsertId();
    jsonResponse(['message' => ['id' => $mid, 'thread_id' => $threadId, 'role' => $role]]);
    exit;
}

jsonError('Unknown action');
exit;
