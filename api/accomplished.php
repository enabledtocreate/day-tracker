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
$summaryOrg = isset($_GET['summary_org']) && $_GET['summary_org'] !== '0' && $_GET['summary_org'] !== '';
logMessage('INFO', 'accomplished.php branch', ['day_id' => $dayId, 'date' => $date ?: null, 'list_all' => $listAll, 'summary_org' => $summaryOrg, 'user_id' => $userId]);

/**
 * Duration in hours from scheduled slot times (matches CompletedPanel desktop logic).
 */
function accomplished_slot_hours(?string $start, ?string $end): float
{
    if ($start === null || $start === '' || $end === null || $end === '') {
        return 0.0;
    }
    $parse = static function (string $t): int {
        $parts = array_map('intval', explode(':', $t));
        $h = $parts[0] ?? 0;
        $m = $parts[1] ?? 0;
        return $h * 60 + $m;
    };
    $dm = $parse($end) - $parse($start);
    if ($dm <= 0) {
        return 0.0;
    }
    return round($dm / 60, 2);
}

if ($summaryOrg) {
    $hasOrg = (bool) $pdo->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_category'")->fetchColumn();
    if ($hasOrg) {
        $stmt = $pdo->query("
            SELECT d.date, s.task_id, t.title, s.start_time, s.end_time,
                cat.name AS category_name,
                sub.name AS subcategory_name
            FROM scheduled_slots s
            JOIN day_record d ON d.id = s.day_record_id
            JOIN tasks t ON t.id = s.task_id
            LEFT JOIN task_category tcat ON tcat.task_id = t.id
            LEFT JOIN task_categories cat ON cat.id = tcat.category_id
            LEFT JOIN task_subcategory tsub ON tsub.task_id = t.id
            LEFT JOIN task_subcategories sub ON sub.id = tsub.subcategory_id
            WHERE s.completed = 1
            ORDER BY d.date ASC, s.id ASC
        ");
    } else {
        $stmt = $pdo->query("
            SELECT d.date, s.task_id, t.title, s.start_time, s.end_time,
                NULL AS category_name,
                NULL AS subcategory_name
            FROM scheduled_slots s
            JOIN day_record d ON d.id = s.day_record_id
            JOIN tasks t ON t.id = s.task_id
            WHERE s.completed = 1
            ORDER BY d.date ASC, s.id ASC
        ");
    }
    $rows = $stmt ? $stmt->fetchAll(PDO::FETCH_ASSOC) : [];
    /** @var array<string, array<string, array{hours: float, titles: array<int, string>}>> */
    $acc = [];
    foreach ($rows as $r) {
        $day = $r['date'];
        $hours = accomplished_slot_hours($r['start_time'] ?? null, $r['end_time'] ?? null);
        $cat = isset($r['category_name']) && $r['category_name'] !== '' && $r['category_name'] !== null
            ? (string) $r['category_name']
            : '(Uncategorized)';
        $subRaw = $r['subcategory_name'] ?? null;
        $sub = isset($subRaw) && $subRaw !== '' ? (string) $subRaw : '';
        $bucketKey = $cat . "\0" . $sub;
        if (!isset($acc[$day])) {
            $acc[$day] = [];
        }
        if (!isset($acc[$day][$bucketKey])) {
            $acc[$day][$bucketKey] = ['hours' => 0.0, 'titles' => []];
        }
        $acc[$day][$bucketKey]['hours'] = round($acc[$day][$bucketKey]['hours'] + $hours, 2);
        $title = trim((string) ($r['title'] ?? ''));
        if ($title !== '') {
            $acc[$day][$bucketKey]['titles'][$title] = $title;
        }
    }
    $daysOut = [];
    foreach ($acc as $dayStr => $buckets) {
        $rowOut = [];
        foreach ($buckets as $bucketKey => $data) {
            [$c, $s] = explode("\0", $bucketKey, 2);
            $titles = array_values($data['titles']);
            sort($titles, SORT_STRING);
            $rowOut[] = [
                'category' => $c,
                'subcategory' => $s !== '' ? $s : null,
                'hours' => $data['hours'],
                'titles' => $titles,
            ];
        }
        usort($rowOut, static function ($a, $b) {
            $ca = strcmp($a['category'], $b['category']);
            if ($ca !== 0) {
                return $ca;
            }
            $sa = $a['subcategory'] ?? '';
            $sb = $b['subcategory'] ?? '';
            return strcmp($sa, $sb);
        });
        $daysOut[] = ['date' => $dayStr, 'rows' => $rowOut];
    }
    usort($daysOut, static function ($a, $b) {
        return strcmp($b['date'], $a['date']);
    });
    logMessage('INFO', 'accomplished summary_org ok', ['days' => count($daysOut)]);
    jsonResponse(['days' => $daysOut]);
    exit;
}

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
