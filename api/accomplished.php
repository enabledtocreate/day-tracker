<?php
/**
 * GET accomplished tasks for a day (by day_record_id or date).
 */
require_once __DIR__ . '/common.php';
require_once dirname(__DIR__) . '/lib/logger.php';

$pdo = getPdoSafe();
$dayId = isset($_GET['day_id']) ? (int) $_GET['day_id'] : 0;
$date = $_GET['date'] ?? '';
$listAll = isset($_GET['list_all']) && $_GET['list_all'] !== '0' && $_GET['list_all'] !== '';
logMessage('INFO', 'accomplished.php branch', ['day_id' => $dayId, 'date' => $date ?: null, 'list_all' => $listAll, 'user_id' => $userId]);

if ($listAll) {
    $with = isset($_GET['with']) ? trim((string) $_GET['with']) : '';
    $withLinks = $with !== '' && in_array('links', array_map('trim', explode(',', $with)), true);
    $withListItems = $with !== '' && in_array('list_items', array_map('trim', explode(',', $with)), true);

    logMessage('INFO', 'accomplished listAll');
    $stmt = $pdo->prepare("
        SELECT s.id, s.day_record_id, s.task_id, t.title, s.start_time, s.end_time AS completed_at, d.date
        FROM scheduled_slots s
        JOIN day_record d ON d.id = s.day_record_id
        JOIN tasks t ON t.id = s.task_id
        WHERE s.completed = 1 AND t.parent_id IS NULL
        ORDER BY d.date DESC, s.end_time
    ");
    $stmt->execute();
    $roots = $stmt->fetchAll(PDO::FETCH_ASSOC);
    $byDate = [];
    $childStmt = $pdo->prepare("
        SELECT s.id, s.task_id, t.title, s.start_time, s.end_time AS completed_at
        FROM scheduled_slots s
        JOIN tasks t ON t.id = s.task_id
        WHERE s.day_record_id = ? AND s.completed = 1 AND t.parent_id = ?
        ORDER BY s.end_time
    ");
    $taskIds = [];
    foreach ($roots as $r) {
        $taskIds[] = (int) $r['task_id'];
        $d = $r['date'];
        unset($r['date']);
        $r['subtasks'] = [];
        $childStmt->execute([$r['day_record_id'], $r['task_id']]);
        while ($row = $childStmt->fetch(PDO::FETCH_ASSOC)) {
            $r['subtasks'][] = $row;
            $taskIds[] = (int) $row['task_id'];
        }
        if (!isset($byDate[$d])) {
            $byDate[$d] = [];
        }
        $byDate[$d][] = $r;
    }
    $taskIds = array_values(array_unique($taskIds));
    $out = ['byDate' => $byDate];
    if (($withLinks || $withListItems) && count($taskIds) > 0) {
        if ($withLinks) {
            $placeholders = implode(',', array_fill(0, count($taskIds), '?'));
            $linkStmt = $pdo->prepare("SELECT id, task_id, url, description FROM task_links WHERE task_id IN ({$placeholders}) ORDER BY task_id, id");
            $linkStmt->execute($taskIds);
            $linkRows = $linkStmt->fetchAll(PDO::FETCH_ASSOC);
            $linksByTaskId = [];
            foreach ($linkRows as $row) {
                $tid = (int) $row['task_id'];
                if (!isset($linksByTaskId[$tid])) $linksByTaskId[$tid] = [];
                $linksByTaskId[$tid][] = $row;
            }
            $out['linksByTaskId'] = $linksByTaskId;
        }
        if ($withListItems) {
            $placeholders = implode(',', array_fill(0, count($taskIds), '?'));
            $itemStmt = $pdo->prepare("SELECT id, task_id, content, order_index, completed FROM task_list_items WHERE task_id IN ({$placeholders}) ORDER BY task_id, order_index ASC, id ASC");
            $itemStmt->execute($taskIds);
            $itemRows = $itemStmt->fetchAll(PDO::FETCH_ASSOC);
            $listItemsByTaskId = [];
            foreach ($itemRows as $row) {
                $tid = (int) $row['task_id'];
                if (!isset($listItemsByTaskId[$tid])) $listItemsByTaskId[$tid] = [];
                $listItemsByTaskId[$tid][] = $row;
            }
            $out['listItemsByTaskId'] = $listItemsByTaskId;
        }
    }
    logMessage('INFO', 'accomplished listAll ok', ['dates' => count($byDate), 'with' => $with]);
    jsonResponse($out);
    exit;
}

if ($dayId > 0) {
    logMessage('INFO', 'accomplished by day_id', ['day_id' => $dayId]);
    $stmt = $pdo->prepare("SELECT s.id, s.day_record_id, s.task_id, t.title, s.end_time AS completed_at FROM scheduled_slots s JOIN tasks t ON t.id = s.task_id WHERE s.day_record_id = ? AND s.completed = 1 AND t.parent_id IS NULL ORDER BY s.end_time");
    $stmt->execute([$dayId]);
} elseif (preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
    logMessage('INFO', 'accomplished by date', ['date' => $date]);
    $stmt = $pdo->prepare("SELECT s.id, s.day_record_id, s.task_id, t.title, s.end_time AS completed_at FROM scheduled_slots s JOIN day_record d ON d.id = s.day_record_id JOIN tasks t ON t.id = s.task_id WHERE d.date = ? AND s.completed = 1 AND t.parent_id IS NULL ORDER BY s.end_time");
    $stmt->execute([$date]);
} else {
    logMessage('INFO', 'accomplished no day_id or date');
    jsonResponse(['accomplished' => []]);
    exit;
}

$rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
logMessage('INFO', 'accomplished ok', ['count' => count($rows)]);
jsonResponse(['accomplished' => $rows]);
