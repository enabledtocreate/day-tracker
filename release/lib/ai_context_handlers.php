<?php
/**
 * Allow-listed context resolution for AI dataRequests (plan §6.2).
 */
declare(strict_types=1);

/**
 * @return array{0: mixed, 1: int} [data, row_estimate]
 */
function aiContextResolveQuery(PDO $pdo, string $queryId, array $params, int $rowBudget): array
{
    switch ($queryId) {
        case 'tasks.list':
            return aiContextTasksList($pdo, $params, $rowBudget);
        case 'slots.range':
            return aiContextSlotsRange($pdo, $params, $rowBudget);
        case 'accomplished.range':
            return aiContextAccomplishedRange($pdo, $params, $rowBudget);
        case 'org.catalog':
            return aiContextOrgCatalog($pdo, $rowBudget);
        case 'settings.schedule':
            return aiContextSettingsSchedule($pdo);
        case 'ical.events.range':
            return aiContextIcalEventsRange($pdo, $params, $rowBudget);
        default:
            throw new InvalidArgumentException('Unknown queryId: ' . $queryId);
    }
}

/** @return array{0: array, 1: int} */
function aiContextTasksList(PDO $pdo, array $params, int $rowBudget): array
{
    $withOrg = !empty($params['with_org']);
    $stmt = $pdo->query("SELECT id, title, priority, recurring, parent_id, list_state, list_style FROM tasks ORDER BY id ASC");
    $rows = $stmt ? $stmt->fetchAll(PDO::FETCH_ASSOC) : [];
    if (count($rows) > $rowBudget) {
        $rows = array_slice($rows, 0, $rowBudget);
    }
    $out = ['tasks' => $rows];
    if ($withOrg && count($rows) > 0) {
        $hasCat = (bool) $pdo->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_category'")->fetchColumn();
        if ($hasCat) {
            $taskIds = array_map('intval', array_column($rows, 'id'));
            $placeholders = implode(',', array_fill(0, count($taskIds), '?'));
            $byTask = [];
            $tcat = $pdo->prepare("SELECT task_id, category_id FROM task_category WHERE task_id IN ({$placeholders})");
            $tcat->execute($taskIds);
            foreach ($tcat->fetchAll(PDO::FETCH_ASSOC) as $r) {
                $byTask[(int) $r['task_id']] = ['category_id' => $r['category_id'] ? (int) $r['category_id'] : null, 'subcategory_id' => null];
            }
            $tsub = $pdo->prepare("SELECT task_id, subcategory_id FROM task_subcategory WHERE task_id IN ({$placeholders})");
            $tsub->execute($taskIds);
            foreach ($tsub->fetchAll(PDO::FETCH_ASSOC) as $r) {
                $tid = (int) $r['task_id'];
                if (!isset($byTask[$tid])) {
                    $byTask[$tid] = ['category_id' => null, 'subcategory_id' => null];
                }
                $byTask[$tid]['subcategory_id'] = $r['subcategory_id'] ? (int) $r['subcategory_id'] : null;
            }
            $tagStmt = $pdo->prepare("SELECT task_id, tag_id FROM task_tag WHERE task_id IN ({$placeholders})");
            $tagStmt->execute($taskIds);
            $tagsByTask = [];
            foreach ($tagStmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
                $tid = (int) $r['task_id'];
                if (!isset($tagsByTask[$tid])) {
                    $tagsByTask[$tid] = [];
                }
                $tagsByTask[$tid][] = (int) $r['tag_id'];
            }
            $out['organizationByTaskId'] = $byTask;
            $out['tagIdsByTaskId'] = $tagsByTask;
        }
    }
    return [$out, count($rows)];
}

/** @return array{0: array, 1: int} */
function aiContextSlotsRange(PDO $pdo, array $params, int $rowBudget): array
{
    $from = $params['from'] ?? '';
    $to = $params['to'] ?? '';
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $from) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $to)) {
        throw new InvalidArgumentException('slots.range requires from and to dates');
    }
    $stmt = $pdo->prepare("
        SELECT d.date, s.id, s.day_record_id, s.task_id, s.start_time, s.end_time, s.completed, s.order_index,
               t.title, t.priority, t.recurring, t.parent_id
        FROM day_record d
        JOIN scheduled_slots s ON s.day_record_id = d.id
        JOIN tasks t ON t.id = s.task_id
        WHERE d.date >= ? AND d.date <= ?
        ORDER BY d.date, s.start_time, s.id
        LIMIT " . (int) max(1, min($rowBudget, 2000)));
    $stmt->execute([$from, $to]);
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
    return [['byDate' => $byDate, 'from' => $from, 'to' => $to], count($rows)];
}

/** @return array{0: array, 1: int} */
function aiContextAccomplishedRange(PDO $pdo, array $params, int $rowBudget): array
{
    $from = $params['from'] ?? '';
    $to = $params['to'] ?? '';
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $from) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $to)) {
        throw new InvalidArgumentException('accomplished.range requires from and to dates');
    }
    $stmt = $pdo->prepare("
        SELECT d.date, s.id, s.task_id, t.title, s.end_time AS completed_at
        FROM scheduled_slots s
        JOIN day_record d ON d.id = s.day_record_id
        JOIN tasks t ON t.id = s.task_id
        WHERE s.completed = 1 AND t.parent_id IS NULL AND d.date >= ? AND d.date <= ?
        ORDER BY d.date ASC, s.end_time ASC
        LIMIT " . (int) max(1, min($rowBudget, 2000)));
    $stmt->execute([$from, $to]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    return [['accomplished' => $rows, 'from' => $from, 'to' => $to], count($rows)];
}

/** @return array{0: array, 1: int} */
function aiContextOrgCatalog(PDO $pdo, int $rowBudget): array
{
    $hasCat = (bool) $pdo->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_categories'")->fetchColumn();
    if (!$hasCat) {
        return [['categories' => [], 'subcategories' => [], 'tags' => []], 0];
    }
    $cat = $pdo->query("SELECT id, name, color FROM task_categories ORDER BY id")->fetchAll(PDO::FETCH_ASSOC);
    $sub = $pdo->query("SELECT id, category_id, name FROM task_subcategories ORDER BY id")->fetchAll(PDO::FETCH_ASSOC);
    $tags = $pdo->query("SELECT id, name, color FROM task_tags ORDER BY id")->fetchAll(PDO::FETCH_ASSOC);
    $n = count($cat) + count($sub) + count($tags);
    return [['categories' => $cat, 'subcategories' => $sub, 'tags' => $tags], $n];
}

/** @return array{0: array, 1: int} */
function aiContextSettingsSchedule(PDO $pdo): array
{
    $stmt = $pdo->query("SELECT key, value FROM app_settings WHERE key IN ('start_hour','end_hour','increment_value','increment_unit','timezone')");
    $rows = $stmt ? $stmt->fetchAll(PDO::FETCH_KEY_PAIR) : [];
    $settings = [
        'start_hour' => (int) ($rows['start_hour'] ?? 6),
        'end_hour' => (int) ($rows['end_hour'] ?? 23),
        'increment_value' => (int) ($rows['increment_value'] ?? 15),
        'increment_unit' => $rows['increment_unit'] ?? 'min',
        'timezone' => isset($rows['timezone']) ? (string) $rows['timezone'] : '',
    ];
    if ($settings['increment_unit'] !== 'min' && $settings['increment_unit'] !== 'hr') {
        $settings['increment_unit'] = 'min';
    }
    return [$settings, 1];
}

/** @return array{0: array, 1: int} */
function aiContextIcalEventsRange(PDO $pdo, array $params, int $rowBudget): array
{
    $from = $params['from'] ?? '';
    $to = $params['to'] ?? '';
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $from) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $to)) {
        throw new InvalidArgumentException('ical.events.range requires from and to dates');
    }
    $has = (bool) $pdo->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ical_feed_events'")->fetchColumn();
    if (!$has) {
        return [['events' => []], 0];
    }
    $fromIso = $from . 'T00:00:00';
    $toIso = $to . 'T23:59:59';
    $lim = (int) max(1, min($rowBudget, 1000));
    $stmt = $pdo->prepare("
        SELECT id, subscription_id, uid, title, start_iso, end_iso, all_day
        FROM ical_feed_events
        WHERE start_iso <= ? AND end_iso >= ?
        ORDER BY start_iso
        LIMIT {$lim}
    ");
    $stmt->execute([$toIso, $fromIso]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    return [['events' => $rows, 'from' => $from, 'to' => $to], count($rows)];
}
