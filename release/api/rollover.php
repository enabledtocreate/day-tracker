<?php
/**
 * Rollover: for all past days (date < given "today"), delete incomplete scheduled_slots.
 * Tasks that were in those slots remain in the tasks table and reappear in the unscheduled list.
 */
require_once __DIR__ . '/common.php';
require_once dirname(__DIR__) . '/lib/logger.php';
require_once dirname(__DIR__) . '/lib/auto_priority.php';

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

// Remove completed group members once their completion day has passed (today > completion day).
// Incomplete members always stay grouped; past-day incomplete slots are deleted below.
$colStmt = $pdo->query('PRAGMA table_info(tasks)');
$colNames = $colStmt ? array_column($colStmt->fetchAll(PDO::FETCH_ASSOC), 'name') : [];
$hasGroupOrder = in_array('group_order', $colNames, true);
$ungroupStmt = $pdo->prepare("
    SELECT DISTINCT t.id
    FROM tasks t
    INNER JOIN scheduled_slots s ON s.task_id = t.id AND s.completed = 1
    INNER JOIN day_record d ON d.id = s.day_record_id AND d.date < ?
    WHERE t.parent_id IS NOT NULL
");
$ungroupStmt->execute([$date]);
$toUngroup = array_map('intval', $ungroupStmt->fetchAll(PDO::FETCH_COLUMN));
if (count($toUngroup) > 0) {
    $placeholders = implode(',', array_fill(0, count($toUngroup), '?'));
    if ($hasGroupOrder) {
        $pdo->prepare("UPDATE tasks SET parent_id = NULL, group_order = 0 WHERE id IN ({$placeholders})")->execute($toUngroup);
    } else {
        $pdo->prepare("UPDATE tasks SET parent_id = NULL WHERE id IN ({$placeholders})")->execute($toUngroup);
    }
    logMessage('INFO', 'rollover ungroup completed past-day group members', ['count' => count($toUngroup)]);
}

foreach ($dayIds as $dayId) {
    $pdo->prepare("DELETE FROM scheduled_slots WHERE day_record_id = ? AND completed = 0")->execute([$dayId]);
}

// Recurring tasks: no longer clone new task rows. Completed occurrences stay as scheduled_slots with completed=1.

$nAuto = dt_apply_auto_priorities($pdo, $date);
logMessage('INFO', 'rollover auto_priority', ['date' => $date, 'tasks_updated' => $nAuto]);

logMessage('INFO', 'rollover ok', ['date' => $date, 'days_processed' => count($dayIds)]);
jsonResponse(['ok' => true]);
