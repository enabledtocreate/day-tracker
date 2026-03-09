<?php
/**
 * Day record API: get or create day_record for a given date (YYYY-MM-DD).
 */
require_once __DIR__ . '/common.php';
require_once dirname(__DIR__) . '/lib/logger.php';

$pdo = getPdoSafe();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
logMessage('INFO', 'day.php branch', ['method' => $method, 'user_id' => $userId]);

if ($method !== 'GET') {
    logMessage('WARNING', 'day method not allowed');
    jsonError('Method not allowed', 405);
    exit;
}

$date = $_GET['date'] ?? '';
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
    logMessage('WARNING', 'day date validation failed');
    jsonError('date required (YYYY-MM-DD)');
    exit;
}

logMessage('INFO', 'day getOrCreate', ['date' => $date]);
$stmt = $pdo->prepare("SELECT id, date FROM day_record WHERE date = ?");
$stmt->execute([$date]);
$row = $stmt->fetch(PDO::FETCH_ASSOC);
if ($row) {
    logMessage('INFO', 'day getOrCreate ok found', ['id' => (int) $row['id'], 'date' => $date]);
    jsonResponse(['id' => (int) $row['id'], 'date' => $row['date']]);
    exit;
}

$pdo->prepare("INSERT INTO day_record (date) VALUES (?)")->execute([$date]);
$id = (int) $pdo->lastInsertId();
logMessage('INFO', 'day getOrCreate ok created', ['id' => $id, 'date' => $date]);
jsonResponse(['id' => $id, 'date' => $date]);
