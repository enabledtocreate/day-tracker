<?php
/**
 * Rollover: for all past days (date < given "today"), delete incomplete scheduled_slots.
 * Tasks that were in those slots remain in the tasks table and reappear in the unscheduled list.
 */
require_once __DIR__ . '/common.php';
require_once dirname(__DIR__) . '/lib/logger.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
logMessage('INFO', 'rollover.php branch', ['method' => $method, 'user_id' => $userId]);
if ($method !== 'POST') {
    logMessage('WARNING', 'rollover method not allowed');
    jsonError('Method not allowed', 405);
    exit;
}

$date = $_GET['date'] ?? '';
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
    logMessage('WARNING', 'rollover date validation failed');
    jsonError('date required (YYYY-MM-DD)');
    exit;
}

logMessage('INFO', 'rollover run', ['date' => $date]);
$pdo = getPdoSafe();

$stmt = $pdo->prepare("SELECT id FROM day_record WHERE date < ?");
$stmt->execute([$date]);
$dayIds = $stmt->fetchAll(PDO::FETCH_COLUMN);

foreach ($dayIds as $dayId) {
    $pdo->prepare("DELETE FROM scheduled_slots WHERE day_record_id = ? AND completed = 0")->execute([$dayId]);
}

// Recurring tasks: no longer clone new task rows. Completed occurrences stay as scheduled_slots with completed=1.

logMessage('INFO', 'rollover ok', ['date' => $date, 'days_processed' => count($dayIds)]);
jsonResponse(['ok' => true]);
