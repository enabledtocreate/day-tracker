<?php
/**
 * Server-built taskContext for AI chat (see docs/Application-Spec.md §4.8).
 * Shape aligned with client buildTaskContext in components/AIPanel.tsx.
 */
declare(strict_types=1);

require_once __DIR__ . '/ai_context_handlers.php';

/**
 * @param array<string, mixed> $contextOptions e.g. includeIcal, historyDays
 * @return array<string, mixed>
 */
function ai_build_server_task_context(PDO $pdo, string $viewDate, array $contextOptions): array
{
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $viewDate)) {
        return [];
    }

    $stmt = $pdo->prepare('SELECT id FROM day_record WHERE date = ?');
    $stmt->execute([$viewDate]);
    $dayRow = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$dayRow) {
        $pdo->prepare('INSERT INTO day_record (date) VALUES (?)')->execute([$viewDate]);
        $dayId = (int) $pdo->lastInsertId();
    } else {
        $dayId = (int) $dayRow['id'];
    }

    $taskStmt = $pdo->query(
        "SELECT id, title, priority, recurring, parent_id FROM tasks ORDER BY parent_id IS NULL DESC, id ASC"
    );
    $tasks = $taskStmt ? $taskStmt->fetchAll(PDO::FETCH_ASSOC) : [];
    $taskList = [];
    foreach ($tasks as $t) {
        $taskList[] = [
            'id' => (int) $t['id'],
            'title' => $t['title'],
            'priority' => $t['priority'],
            'recurring' => (bool) $t['recurring'],
            'parent_id' => $t['parent_id'] !== null && $t['parent_id'] !== '' ? (int) $t['parent_id'] : null,
        ];
    }

    $accStmt = $pdo->prepare(
        "SELECT t.title, s.end_time AS completed_at
         FROM scheduled_slots s
         JOIN day_record d ON d.id = s.day_record_id
         JOIN tasks t ON t.id = s.task_id
         WHERE d.date = ? AND s.completed = 1 AND t.parent_id IS NULL
         ORDER BY s.end_time"
    );
    $accStmt->execute([$viewDate]);
    $accRows = $accStmt->fetchAll(PDO::FETCH_ASSOC);
    $accomplished = [];
    foreach ($accRows as $r) {
        $accomplished[] = ['title' => $r['title'], 'completed_at' => $r['completed_at']];
    }

    $slotStmt = $pdo->prepare(
        "SELECT s.task_id, t.title, s.start_time, s.end_time, s.completed
         FROM scheduled_slots s
         JOIN tasks t ON t.id = s.task_id
         WHERE s.day_record_id = ?
         ORDER BY COALESCE(s.order_index, 0), s.start_time, s.id"
    );
    $slotStmt->execute([$dayId]);
    $slotRows = $slotStmt->fetchAll(PDO::FETCH_ASSOC);
    $slotsToday = [];
    foreach ($slotRows as $s) {
        $slotsToday[] = [
            'task_id' => (int) $s['task_id'],
            'title' => $s['title'],
            'start_time' => $s['start_time'],
            'end_time' => $s['end_time'],
            'completed' => ((int) ($s['completed'] ?? 0)) === 1,
        ];
    }

    $scheduledTaskIds = [];
    foreach ($slotsToday as $s) {
        if (!$s['completed']) {
            $scheduledTaskIds[$s['task_id']] = true;
        }
    }
    $unaccomplishedToday = [];
    foreach ($taskList as $t) {
        if (!isset($scheduledTaskIds[$t['id']])) {
            $unaccomplishedToday[] = $t['title'];
        }
    }
    foreach ($slotsToday as $s) {
        if (!$s['completed'] && $s['title'] !== '' && $s['title'] !== null) {
            $unaccomplishedToday[] = $s['title'];
        }
    }
    $unaccomplishedToday = array_values(array_unique($unaccomplishedToday));

    [$orgData] = aiContextOrgCatalog($pdo, 5000);
    $organization = [
        'categories' => [],
        'subcategories' => [],
        'tags' => [],
    ];
    foreach ($orgData['categories'] ?? [] as $c) {
        $organization['categories'][] = [
            'id' => (int) $c['id'],
            'name' => $c['name'],
            'color' => $c['color'] ?? null,
        ];
    }
    foreach ($orgData['subcategories'] ?? [] as $s) {
        $organization['subcategories'][] = [
            'id' => (int) $s['id'],
            'category_id' => (int) $s['category_id'],
            'name' => $s['name'],
        ];
    }
    foreach ($orgData['tags'] ?? [] as $t) {
        $organization['tags'][] = [
            'id' => (int) $t['id'],
            'name' => $t['name'],
            'color' => $t['color'] ?? null,
        ];
    }

    $out = [
        'date' => $viewDate,
        'organization' => $organization,
        'accomplished' => $accomplished,
        'taskList' => $taskList,
        'unaccomplishedToday' => $unaccomplishedToday,
        'slotsToday' => $slotsToday,
    ];

    [$sched] = aiContextSettingsSchedule($pdo);
    $out['scheduleSettings'] = $sched;

    $includeIcal = !empty($contextOptions['includeIcal']);
    if ($includeIcal) {
        $days = isset($contextOptions['historyDays']) ? (int) $contextOptions['historyDays'] : 7;
        $days = max(1, min(366, $days));
        $to = date('Y-m-d', strtotime($viewDate . ' +' . $days . ' days'));
        try {
            [$icalData] = aiContextIcalEventsRange($pdo, ['from' => $viewDate, 'to' => $to], 500);
            $out['icalEvents'] = $icalData['events'] ?? [];
        } catch (Throwable $e) {
            $out['icalEvents'] = [];
        }
    }

    return $out;
}
