<?php
/**
 * Scheduled slots API: GET by day_record_id, POST create, PATCH (complete/resize), DELETE.
 */
require_once __DIR__ . '/common.php';
require_once __DIR__ . '/../lib/recurrence.php';
require_once dirname(__DIR__) . '/lib/data_integrity.php';
require_once dirname(__DIR__) . '/lib/logger.php';

$pdo = getPdoSafe();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
logMessage('INFO', 'slots.php branch', ['method' => $method, 'user_id' => $userId]);

function ensureRecurringOccurrenceStateTable(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS recurring_occurrence_state (
        recurring_task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        occurrence_date TEXT NOT NULL,
        completed_for_day INTEGER NOT NULL DEFAULT 0,
        overridden_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
        source_slot_id INTEGER REFERENCES scheduled_slots(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (recurring_task_id, occurrence_date)
    )");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_recurring_occurrence_state_day ON recurring_occurrence_state (occurrence_date)");
}

function upsertRecurringOccurrenceCompletion(PDO $pdo, int $taskId, string $date, ?int $slotId = null): void
{
    ensureRecurringOccurrenceStateTable($pdo);
    $stmt = $pdo->prepare(
        "INSERT INTO recurring_occurrence_state (recurring_task_id, occurrence_date, completed_for_day, source_slot_id, updated_at)
         VALUES (?, ?, 1, ?, datetime('now'))
         ON CONFLICT(recurring_task_id, occurrence_date) DO UPDATE SET
           completed_for_day = 1,
           source_slot_id = COALESCE(excluded.source_slot_id, recurring_occurrence_state.source_slot_id),
           updated_at = datetime('now')"
    );
    $stmt->execute([$taskId, $date, $slotId]);
}

function clearRecurringOccurrenceCompletion(PDO $pdo, int $taskId, string $date): void
{
    ensureRecurringOccurrenceStateTable($pdo);
    $pdo->prepare(
        "UPDATE recurring_occurrence_state
         SET completed_for_day = 0, source_slot_id = NULL, updated_at = datetime('now')
         WHERE recurring_task_id = ? AND occurrence_date = ?"
    )->execute([$taskId, $date]);
    $pdo->prepare(
        "DELETE FROM recurring_occurrence_state
         WHERE recurring_task_id = ? AND occurrence_date = ? AND completed_for_day = 0 AND overridden_task_id IS NULL"
    )->execute([$taskId, $date]);
}

function upsertRecurringOccurrenceOverride(PDO $pdo, int $taskId, string $date, ?int $overrideTaskId = null): void
{
    ensureRecurringOccurrenceStateTable($pdo);
    $stmt = $pdo->prepare(
        "INSERT INTO recurring_occurrence_state (recurring_task_id, occurrence_date, overridden_task_id, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(recurring_task_id, occurrence_date) DO UPDATE SET
           overridden_task_id = excluded.overridden_task_id,
           updated_at = datetime('now')"
    );
    $stmt->execute([$taskId, $date, $overrideTaskId]);
}

if ($method === 'GET') {
    $slotId = isset($_GET['id']) ? (int) $_GET['id'] : 0;
    $dayId = isset($_GET['day_id']) ? (int) $_GET['day_id'] : 0;
    $fromDate = $_GET['from_date'] ?? '';
    $toDate = $_GET['to_date'] ?? '';

    if ($slotId > 0 && $dayId < 1 && $fromDate === '' && $toDate === '') {
        $stmt = $pdo->prepare("SELECT s.id, s.day_record_id, s.task_id, s.start_time, s.end_time, s.completed, s.order_index, t.title, t.priority, t.recurring, t.parent_id, t.list_style, EXISTS (SELECT 1 FROM task_list_items li WHERE li.task_id = t.id) AS has_list FROM scheduled_slots s JOIN tasks t ON t.id = s.task_id WHERE s.id = ?");
        $stmt->execute([$slotId]);
        $slot = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$slot) {
            logMessage('INFO', 'slots GET by id not found', ['slot_id' => $slotId]);
            jsonResponse(['slot' => null, 'childSlots' => []]);
            exit;
        }
        $childStmt = $pdo->prepare("SELECT s.id, s.day_record_id, s.task_id, s.start_time, s.end_time, s.completed, t.parent_id FROM scheduled_slots s JOIN tasks t ON t.id = s.task_id WHERE s.day_record_id = ? AND t.parent_id = ?");
        $childStmt->execute([$slot['day_record_id'], $slot['task_id']]);
        $childSlots = $childStmt->fetchAll(PDO::FETCH_ASSOC);
        logMessage('INFO', 'slots GET by id ok', ['slot_id' => $slotId]);
        jsonResponse(['slot' => $slot, 'childSlots' => $childSlots]);
        exit;
    }

    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $fromDate) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $toDate)) {
        logMessage('INFO', 'slots GET listByDateRange', ['from' => $fromDate, 'to' => $toDate]);
        $stmt = $pdo->prepare("
            SELECT d.date, s.id, s.day_record_id, s.task_id, s.start_time, s.end_time, s.completed, s.order_index,
                   t.title, t.priority, t.recurring, t.parent_id, t.list_style,
                   EXISTS (SELECT 1 FROM task_list_items li WHERE li.task_id = t.id) AS has_list
            FROM day_record d
            JOIN scheduled_slots s ON s.day_record_id = d.id
            JOIN tasks t ON t.id = s.task_id
            WHERE d.date >= ? AND d.date <= ?
            ORDER BY d.date, (s.start_time IS NULL OR s.start_time = '') DESC, s.start_time, s.order_index
        ");
        $stmt->execute([$fromDate, $toDate]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        $byDate = [];
        foreach ($rows as $r) {
            $d = $r['date'];
            unset($r['date']);
            if (!isset($byDate[$d])) {
                $byDate[$d] = [];
            }
            $byDate[$d][] = $r;
        }
        // Add virtual recurring slots for each date in range
        $hasRecurrenceRule = $pdo->query("SELECT 1 FROM pragma_table_info('tasks') WHERE name = 'recurrence_rule'")->fetchColumn();
        if ($hasRecurrenceRule) {
            $recurringStmt = $pdo->prepare("
                SELECT t.id AS task_id, t.title, t.priority, t.recurring, t.parent_id, t.list_style, t.recurrence_rule
                FROM tasks t
                WHERE t.recurring = 1 AND t.parent_id IS NULL
            ");
        } else {
            $recurringStmt = $pdo->prepare("
                SELECT t.id AS task_id, t.title, t.priority, t.recurring, t.parent_id, t.list_style
                FROM tasks t
                WHERE t.recurring = 1 AND t.parent_id IS NULL
            ");
        }
        $recurringStmt->execute();
        $recurringTasks = $recurringStmt->fetchAll(PDO::FETCH_ASSOC);
        $overrideSkip = [];
        try {
            ensureRecurringOccurrenceStateTable($pdo);
            $ovStmt = $pdo->prepare("
                SELECT recurring_task_id, occurrence_date
                FROM recurring_occurrence_state
                WHERE occurrence_date >= ? AND occurrence_date <= ?
                  AND (completed_for_day = 1 OR overridden_task_id IS NOT NULL)
            ");
            $ovStmt->execute([$fromDate, $toDate]);
            while ($ov = $ovStmt->fetch(PDO::FETCH_ASSOC)) {
                $overrideSkip[((string) $ov['occurrence_date']) . '|' . (int) $ov['recurring_task_id']] = true;
            }
        } catch (Throwable $e) {
            logMessage('NOTICE', 'slots listByDateRange override map unavailable', ['message' => $e->getMessage()]);
        }
        foreach ($recurringTasks as $task) {
            $tid = (int) $task['task_id'];
            $rule = null;
            if (!empty($task['recurrence_rule'])) {
                $decoded = @json_decode($task['recurrence_rule'], true);
                $rule = is_array($decoded) ? $decoded : null;
            }
            $countLimit = isset($rule['count']) ? max(1, (int) $rule['count']) : null;
            $startDate = isset($rule['startDate']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $rule['startDate']) ? $rule['startDate'] : $fromDate;
            $occurrences = 0;
            $current = $startDate;
            while ($current <= $toDate && ($countLimit === null || $occurrences < $countLimit)) {
                if (!recurrenceMatchesDate($rule, $current)) {
                    $current = date('Y-m-d', strtotime($current . ' +1 day'));
                    continue;
                }
                $occurrences++;
                if ($current >= $fromDate) {
                    if (isset($overrideSkip[$current . '|' . $tid])) {
                        $current = date('Y-m-d', strtotime($current . ' +1 day'));
                        continue;
                    }
                    if (!isset($byDate[$current])) {
                        $byDate[$current] = [];
                    }
                    $realTaskIdsOnDay = array_column($byDate[$current], 'task_id');
                    if (!in_array($tid, $realTaskIdsOnDay, true)) {
                        $ruleTime = isset($rule['time']) && is_string($rule['time']) ? $rule['time'] : '09:00';
                        $parts = array_map('intval', explode(':', $ruleTime));
                        $h = $parts[0] ?? 9;
                        $m = $parts[1] ?? 0;
                        $startTime = sprintf('%02d:%02d', $h, $m);
                        $endM = $m + 30;
                        $endH = $h + (int) floor($endM / 60);
                        $endM = $endM % 60;
                        $endTime = sprintf('%02d:%02d', $endH, $endM);
                        $byDate[$current][] = [
                            'id' => -$tid,
                            'day_record_id' => 0,
                            'task_id' => $tid,
                            'start_time' => $startTime,
                            'end_time' => $endTime,
                            'completed' => 0,
                            'order_index' => 999,
                            'title' => $task['title'],
                            'priority' => $task['priority'],
                            'recurring' => (int) $task['recurring'],
                            'parent_id' => $task['parent_id'],
                            'list_style' => $task['list_style'],
                            'has_list' => 0,
                            'is_recurring_occurrence' => true,
                        ];
                    }
                }
                $current = date('Y-m-d', strtotime($current . ' +1 day'));
            }
        }
        $out = ['byDate' => $byDate];
        $with = isset($_GET['with']) ? trim((string) $_GET['with']) : '';
        $withLinks = $with !== '' && in_array('links', array_map('trim', explode(',', $with)), true);
        $withListItems = $with !== '' && in_array('list_items', array_map('trim', explode(',', $with)), true);
        if ($withLinks || $withListItems) {
            $taskIds = [];
            foreach ($byDate as $slots) {
                foreach ($slots as $s) {
                    $taskIds[(int) $s['task_id']] = true;
                }
            }
            $taskIds = array_values(array_keys($taskIds));
            if (count($taskIds) > 0) {
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
        }
        logMessage('INFO', 'slots listByDateRange ok', ['dates' => count($byDate), 'with' => $with]);
        jsonResponse($out);
        exit;
    }

    if ($dayId < 1) {
        logMessage('INFO', 'slots GET day_id missing');
        jsonResponse(['slots' => []]);
        exit;
    }
    logMessage('INFO', 'slots GET list', ['day_id' => $dayId]);
    $stmt = $pdo->prepare("
        SELECT s.id, s.day_record_id, s.task_id, s.start_time, s.end_time, s.completed, s.order_index,
               t.title, t.priority, t.recurring, t.parent_id, t.list_style,
               EXISTS (SELECT 1 FROM task_list_items li WHERE li.task_id = t.id) AS has_list
        FROM scheduled_slots s
        JOIN tasks t ON t.id = s.task_id
        WHERE s.day_record_id = ?
        ORDER BY (s.start_time IS NULL OR s.start_time = '') DESC, s.start_time, s.order_index
    ");
    $stmt->execute([$dayId]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Add virtual slots for recurring tasks that recur on this day but have no real slot here
    $dayRow = $pdo->prepare("SELECT date FROM day_record WHERE id = ?");
    $dayRow->execute([$dayId]);
    $dayDate = $dayRow->fetchColumn();
    if ($dayDate) {
        $hasRecurrenceRule = $pdo->query("SELECT 1 FROM pragma_table_info('tasks') WHERE name = 'recurrence_rule'")->fetchColumn();
        $realTaskIdsOnDay = array_column($rows, 'task_id');
        if ($hasRecurrenceRule) {
            $recurringStmt = $pdo->prepare("
                SELECT t.id AS task_id, t.title, t.priority, t.recurring, t.parent_id, t.list_style, t.recurrence_rule,
                       (SELECT s.start_time FROM scheduled_slots s WHERE s.task_id = t.id AND s.start_time IS NOT NULL LIMIT 1) AS start_time,
                       (SELECT s.end_time FROM scheduled_slots s WHERE s.task_id = t.id AND s.end_time IS NOT NULL LIMIT 1) AS end_time
                FROM tasks t
                WHERE t.recurring = 1 AND t.parent_id IS NULL
            ");
        } else {
            $recurringStmt = $pdo->prepare("
                SELECT t.id AS task_id, t.title, t.priority, t.recurring, t.parent_id, t.list_style,
                       (SELECT s.start_time FROM scheduled_slots s WHERE s.task_id = t.id AND s.start_time IS NOT NULL LIMIT 1) AS start_time,
                       (SELECT s.end_time FROM scheduled_slots s WHERE s.task_id = t.id AND s.end_time IS NOT NULL LIMIT 1) AS end_time
                FROM tasks t
                WHERE t.recurring = 1 AND t.parent_id IS NULL
            ");
        }
        $recurringStmt->execute();
        $overrideSkipTaskIds = [];
        try {
            ensureRecurringOccurrenceStateTable($pdo);
            $ovStmt = $pdo->prepare("
                SELECT recurring_task_id
                FROM recurring_occurrence_state
                WHERE occurrence_date = ?
                  AND (completed_for_day = 1 OR overridden_task_id IS NOT NULL)
            ");
            $ovStmt->execute([$dayDate]);
            while ($ov = $ovStmt->fetch(PDO::FETCH_ASSOC)) {
                $overrideSkipTaskIds[(int) $ov['recurring_task_id']] = true;
            }
        } catch (Throwable $e) {
            logMessage('NOTICE', 'slots list override map unavailable', ['message' => $e->getMessage()]);
        }
        while ($task = $recurringStmt->fetch(PDO::FETCH_ASSOC)) {
            $tid = (int) $task['task_id'];
            if (isset($overrideSkipTaskIds[$tid])) {
                continue;
            }
            if (in_array($tid, $realTaskIdsOnDay, true)) {
                continue;
            }
            $rule = null;
            if (!empty($task['recurrence_rule'])) {
                $decoded = @json_decode($task['recurrence_rule'], true);
                $rule = is_array($decoded) ? $decoded : null;
            }
            if (!recurrenceMatchesDate($rule, $dayDate)) {
                continue;
            }
            // If rule has count, only show this day if it's within the first N occurrences
            if (isset($rule['count']) && (int) $rule['count'] >= 1) {
                $startDate = isset($rule['startDate']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $rule['startDate']) ? $rule['startDate'] : $dayDate;
                $countLimit = max(1, (int) $rule['count']);
                $occurrences = 0;
                $current = $startDate;
                $dayInRange = false;
                while ($current <= $dayDate && $occurrences < $countLimit) {
                    if (recurrenceMatchesDate($rule, $current)) {
                        $occurrences++;
                        if ($current === $dayDate) {
                            $dayInRange = true;
                            break;
                        }
                    }
                    $current = date('Y-m-d', strtotime($current . ' +1 day'));
                }
                if (!$dayInRange) {
                    continue;
                }
            }
            $ruleTime = isset($rule['time']) && is_string($rule['time']) ? $rule['time'] : null;
            if ($ruleTime !== null && ($task['start_time'] === null || $task['start_time'] === '')) {
                $parts = array_map('intval', explode(':', $ruleTime));
                $h = $parts[0] ?? 9;
                $m = $parts[1] ?? 0;
                $startTime = sprintf('%02d:%02d', $h, $m);
                $endM = $m + 30;
                $endH = $h + (int) floor($endM / 60);
                $endM = $endM % 60;
                $endTime = sprintf('%02d:%02d', $endH, $endM);
            } else {
                $startTime = $task['start_time'] ?? '09:00';
                $endTime = $task['end_time'] ?? '09:30';
            }
            $rows[] = [
                'id' => -$tid,
                'day_record_id' => $dayId,
                'task_id' => $tid,
                'start_time' => $startTime,
                'end_time' => $endTime,
                'completed' => 0,
                'order_index' => 999,
                'title' => $task['title'],
                'priority' => $task['priority'],
                'recurring' => (int) $task['recurring'],
                'parent_id' => $task['parent_id'],
                'list_style' => $task['list_style'],
                'has_list' => 0,
                'is_recurring_occurrence' => true,
            ];
        }
        usort($rows, function ($a, $b) {
            $aNull = empty($a['start_time']);
            $bNull = empty($b['start_time']);
            if ($aNull !== $bNull) return $aNull ? 1 : -1;
            if ($aNull) return ($a['order_index'] ?? 0) <=> ($b['order_index'] ?? 0);
            return strcmp($a['start_time'] ?? '', $b['start_time'] ?? '');
        });
    }

    $out = ['slots' => $rows];
    $with = isset($_GET['with']) ? trim((string) $_GET['with']) : '';
    $withLinks = $with !== '' && in_array('links', array_map('trim', explode(',', $with)), true);
    $withListItems = $with !== '' && in_array('list_items', array_map('trim', explode(',', $with)), true);
    if (($withLinks || $withListItems) && count($rows) > 0) {
        $taskIds = array_values(array_unique(array_map(function ($s) { return (int) $s['task_id']; }, $rows)));
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
    logMessage('INFO', 'slots list ok', ['day_id' => $dayId, 'count' => count($rows), 'with' => $with]);
    jsonResponse($out);
    exit;
}

if ($method === 'POST') {
    $in = readJsonInput();
    if (!$in || empty($in['task_id'])) {
        logMessage('WARNING', 'slots POST validation failed');
        jsonError('task_id required');
        exit;
    }
    $taskId = (int) $in['task_id'];

    if (!empty($in['mark_occurrence_override']) && !empty($in['date']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $in['date'])) {
        $date = (string) $in['date'];
        $overrideTaskId = isset($in['override_task_id']) && (int) $in['override_task_id'] > 0 ? (int) $in['override_task_id'] : null;
        upsertRecurringOccurrenceOverride($pdo, $taskId, $date, $overrideTaskId);
        jsonResponse(['ok' => true]);
        exit;
    }

    if (!empty($in['complete_occurrence']) && !empty($in['date']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $in['date'])) {
        logMessage('INFO', 'slots POST complete_occurrence', ['task_id' => $taskId, 'date' => $in['date']]);
        $occDate = $in['date'];
        $dayRow = $pdo->prepare("SELECT id FROM day_record WHERE date = ?");
        $dayRow->execute([$occDate]);
        $day = $dayRow->fetch(PDO::FETCH_ASSOC);
        if (!$day) {
            $pdo->prepare("INSERT INTO day_record (date) VALUES (?)")->execute([$occDate]);
            $dayId = (int) $pdo->lastInsertId();
        } else {
            $dayId = (int) $day['id'];
        }
        $taskRow = $pdo->prepare("SELECT recurrence_rule FROM tasks WHERE id = ? AND recurring = 1");
        $taskRow->execute([$taskId]);
        $task = $taskRow->fetch(PDO::FETCH_ASSOC);
        if (!$task) {
            jsonError('Recurring task not found');
            exit;
        }
        $startTime = isset($in['start_time']) && (string)$in['start_time'] !== '' ? (string)$in['start_time'] : null;
        $endTime = isset($in['end_time']) && (string)$in['end_time'] !== '' ? (string)$in['end_time'] : null;
        if (($startTime === null || $endTime === null) && !empty($task['recurrence_rule'])) {
            $rule = @json_decode($task['recurrence_rule'], true);
            if (is_array($rule) && !empty($rule['time'])) {
                $parts = array_map('intval', explode(':', $rule['time']));
                $h = $parts[0] ?? 9;
                $m = $parts[1] ?? 0;
                if ($startTime === null) {
                    $startTime = sprintf('%02d:%02d', $h, $m);
                }
                if ($endTime === null) {
                    $endM = $m + 30;
                    $endH = $h + (int) floor($endM / 60);
                    $endM = $endM % 60;
                    $endTime = sprintf('%02d:%02d', $endH, $endM);
                }
            }
        }
        if ($startTime === null) $startTime = '09:00';
        if ($endTime === null) $endTime = '09:30';
        [$startTime, $endTime] = dataIntegrityCoerceSlotTimeFramePair($pdo, $startTime, $endTime);
        $existingStmt = $pdo->prepare("
            SELECT s.id, s.day_record_id, s.task_id, s.start_time, s.end_time, s.completed, s.order_index
            FROM scheduled_slots s
            JOIN day_record d ON d.id = s.day_record_id
            WHERE s.task_id = ? AND d.date = ? AND s.completed = 1
            ORDER BY s.id DESC
            LIMIT 1
        ");
        $existingStmt->execute([$taskId, $occDate]);
        $existing = $existingStmt->fetch(PDO::FETCH_ASSOC);
        if ($existing) {
            upsertRecurringOccurrenceCompletion($pdo, $taskId, $occDate, (int) $existing['id']);
            jsonResponse([
                'id' => (int) $existing['id'],
                'day_record_id' => (int) $existing['day_record_id'],
                'task_id' => (int) $existing['task_id'],
                'start_time' => (string) $existing['start_time'],
                'end_time' => (string) $existing['end_time'],
                'completed' => true,
                'order_index' => (int) $existing['order_index'],
            ]);
            exit;
        }
        $stmt = $pdo->prepare("INSERT INTO scheduled_slots (day_record_id, task_id, start_time, end_time, completed, order_index) VALUES (?, ?, ?, ?, 1, 999)");
        $stmt->execute([$dayId, $taskId, $startTime, $endTime]);
        $id = (int) $pdo->lastInsertId();
        upsertRecurringOccurrenceCompletion($pdo, $taskId, $occDate, $id);
        logMessage('INFO', 'slots complete_occurrence ok', ['id' => $id, 'task_id' => $taskId, 'date' => $occDate]);
        jsonResponse(['id' => $id, 'day_record_id' => $dayId, 'task_id' => $taskId, 'start_time' => $startTime, 'end_time' => $endTime, 'completed' => true, 'order_index' => 999]);
        exit;
    }

    if (empty($in['day_record_id'])) {
        logMessage('WARNING', 'slots create validation failed');
        jsonError('day_record_id and task_id required');
        exit;
    }
    logMessage('INFO', 'slots POST create');
    $dayRecordId = (int) $in['day_record_id'];
    $startTime = isset($in['start_time']) && (string) $in['start_time'] !== '' ? (string) $in['start_time'] : null;
    $endTime = isset($in['end_time']) && (string) $in['end_time'] !== '' ? (string) $in['end_time'] : null;
    [$startTime, $endTime] = dataIntegrityCoerceSlotTimeFramePair($pdo, $startTime, $endTime);
    $orderIndex = isset($in['order_index']) ? (int) $in['order_index'] : 0;
    $completed = !empty($in['completed']) ? 1 : 0;
    $stmt = $pdo->prepare("INSERT INTO scheduled_slots (day_record_id, task_id, start_time, end_time, completed, order_index) VALUES (?, ?, ?, ?, ?, ?)");
    $stmt->execute([$dayRecordId, $taskId, $startTime, $endTime, $completed, $orderIndex]);
    $id = (int) $pdo->lastInsertId();
    logMessage('INFO', 'slots create ok', ['id' => $id, 'day_record_id' => $dayRecordId, 'task_id' => $taskId]);
    jsonResponse(['id' => $id, 'day_record_id' => $dayRecordId, 'task_id' => $taskId, 'start_time' => $startTime, 'end_time' => $endTime, 'completed' => $completed === 1, 'order_index' => $orderIndex]);
    exit;
}

if ($method === 'PATCH') {
    logMessage('INFO', 'slots PATCH update');
    $in = readJsonInput();
    $id = isset($in['id']) ? (int) $in['id'] : 0;
    if ($id < 1) {
        logMessage('WARNING', 'slots update validation failed', ['error' => 'id required']);
        jsonError('id required');
        exit;
    }
    $updates = [];
    $params = [];
    $recurringCompletionSync = null;
    if (array_key_exists('completed', $in)) {
        $completed = !empty($in['completed']) ? 1 : 0;
        $updates[] = 'completed = ?';
        $params[] = $completed;
        try {
            $slotMeta = $pdo->prepare("
                SELECT s.task_id, d.date AS day_date, COALESCE(t.recurring, 0) AS recurring
                FROM scheduled_slots s
                JOIN day_record d ON d.id = s.day_record_id
                JOIN tasks t ON t.id = s.task_id
                WHERE s.id = ?
            ");
            $slotMeta->execute([$id]);
            $slotRow = $slotMeta->fetch(PDO::FETCH_ASSOC);
            if ($slotRow) {
                $recurringCompletionSync = [
                    'task_id' => (int) $slotRow['task_id'],
                    'date' => (string) $slotRow['day_date'],
                    'recurring' => (int) $slotRow['recurring'],
                    'completed' => $completed,
                ];
            }
        } catch (Throwable $e) {
            logMessage('NOTICE', 'slots PATCH recurring completion sync skipped', ['id' => $id, 'message' => $e->getMessage()]);
        }
        // Do not insert into accomplished — completed panel reads from scheduled_slots
    }
    if (array_key_exists('start_time', $in) && array_key_exists('end_time', $in)) {
        $startVal = ($in['start_time'] === null || $in['start_time'] === '') ? null : $in['start_time'];
        $endVal = ($in['end_time'] === null || $in['end_time'] === '') ? null : $in['end_time'];
        [$startVal, $endVal] = dataIntegrityCoerceSlotTimeFramePair($pdo, $startVal, $endVal);
        $updates[] = 'start_time = ?';
        $params[] = $startVal;
        $updates[] = 'end_time = ?';
        $params[] = $endVal;
    } else {
        if (array_key_exists('start_time', $in)) {
            $updates[] = 'start_time = ?';
            $params[] = ($in['start_time'] === null || $in['start_time'] === '') ? null : $in['start_time'];
        }
        if (array_key_exists('end_time', $in)) {
            $updates[] = 'end_time = ?';
            $params[] = ($in['end_time'] === null || $in['end_time'] === '') ? null : $in['end_time'];
        }
    }
    if (array_key_exists('order_index', $in)) {
        $updates[] = 'order_index = ?';
        $params[] = (int) $in['order_index'];
    }
    if (empty($updates)) {
        logMessage('WARNING', 'slots update no fields', ['id' => $id]);
        jsonError('No fields to update');
        exit;
    }
    $params[] = $id;
    $pdo->prepare("UPDATE scheduled_slots SET " . implode(', ', $updates) . " WHERE id = ?")->execute($params);
    if (
        is_array($recurringCompletionSync)
        && (int) ($recurringCompletionSync['recurring'] ?? 0) === 1
        && (string) ($recurringCompletionSync['date'] ?? '') === date('Y-m-d')
    ) {
        if ((int) ($recurringCompletionSync['completed'] ?? 0) === 1) {
            upsertRecurringOccurrenceCompletion($pdo, (int) $recurringCompletionSync['task_id'], (string) $recurringCompletionSync['date'], $id);
        } else {
            clearRecurringOccurrenceCompletion($pdo, (int) $recurringCompletionSync['task_id'], (string) $recurringCompletionSync['date']);
        }
    }
    logMessage('INFO', 'slots update ok', ['id' => $id]);
    jsonResponse(['ok' => true]);
    exit;
}

if ($method === 'DELETE') {
    logMessage('INFO', 'slots DELETE');
    $id = isset($_GET['id']) ? (int) $_GET['id'] : 0;
    if ($id < 1) {
        logMessage('WARNING', 'slots delete validation failed');
        jsonError('id required');
        exit;
    }
    $row = $pdo->prepare("SELECT day_record_id, task_id FROM scheduled_slots WHERE id = ?");
    $row->execute([$id]);
    $slot = $row->fetch(PDO::FETCH_ASSOC);
    if ($slot) {
        $dayRecordId = (int) $slot['day_record_id'];
        $taskId = (int) $slot['task_id'];
        $pdo->prepare("DELETE FROM scheduled_slots WHERE id = ?")->execute([$id]);
        // Also delete all slots on this day for child tasks so parent and children unschedule together
        $pdo->prepare("DELETE FROM scheduled_slots WHERE day_record_id = ? AND task_id IN (SELECT id FROM tasks WHERE parent_id = ?)")
            ->execute([$dayRecordId, $taskId]);
    }
    logMessage('INFO', 'slots delete ok', ['id' => $id]);
    jsonResponse(['ok' => true]);
    exit;
}

logMessage('WARNING', 'slots method not allowed', ['method' => $method]);
jsonError('Method not allowed', 405);
