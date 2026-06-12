<?php
/**
 * Compute per-task auto priority from layout order (index 0 = highest).
 */
declare(strict_types=1);

require_once __DIR__ . '/task_layout.php';

/**
 * Global defaults from app_settings (Schedule Settings).
 *
 * @return array{auto_priority_mode:string, auto_priority_days_per_step:int}
 */
function dt_auto_priority_globals_from_pdo(PDO $pdo): array
{
    $rows = dt_app_settings_subset($pdo, ['auto_priority_default_mode', 'auto_priority_default_days_per_step']);
    $mode = isset($rows['auto_priority_default_mode']) ? (string) $rows['auto_priority_default_mode'] : 'days';
    if ($mode !== 'days' && $mode !== 'due_date') {
        $mode = 'days';
    }
    $step = isset($rows['auto_priority_default_days_per_step']) ? (int) $rows['auto_priority_default_days_per_step'] : 1;
    if ($step < 1) {
        $step = 1;
    }
    if ($step > 365) {
        $step = 365;
    }

    return ['auto_priority_mode' => $mode, 'auto_priority_days_per_step' => $step];
}

/**
 * @param array{priority_mode:string, priority_ids:string[], bucket_mode:string, bucket_ids:string[]} $layout
 * @param array<string, mixed> $task
 * @param array<string, mixed> $global Merged keys auto_priority_mode, auto_priority_days_per_step (from app_settings)
 */
function dt_compute_auto_priority_slug(array $layout, array $task, string $todayYmd, array $global = []): ?string
{
    $ids = $layout['priority_ids'];
    $n = count($ids);
    if ($n < 1) {
        return null;
    }

    $mode = isset($global['auto_priority_mode']) ? (string) $global['auto_priority_mode'] : ((isset($task['auto_priority_mode']) ? (string) $task['auto_priority_mode'] : 'days'));
    if ($mode !== 'days' && $mode !== 'due_date') {
        $mode = 'days';
    }

    if ($mode === 'due_date') {
        $due = isset($task['due_date']) && is_string($task['due_date']) ? trim($task['due_date']) : '';
        if ($due === '' || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $due)) {
            return null;
        }
        $createdRaw = isset($task['created_at']) ? (string) $task['created_at'] : '';
        $created = substr($createdRaw, 0, 10);
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $created)) {
            return null;
        }
        $cTs = strtotime($created . ' 12:00:00 UTC');
        $dTs = strtotime($due . ' 12:00:00 UTC');
        $tTs = strtotime($todayYmd . ' 12:00:00 UTC');
        if ($cTs === false || $dTs === false || $tTs === false) {
            return null;
        }
        if ($dTs <= $cTs) {
            return $ids[0];
        }
        if ($tTs <= $cTs) {
            return $ids[$n - 1];
        }
        if ($tTs >= $dTs) {
            return $ids[0];
        }
        $t = ($tTs - $cTs) / ($dTs - $cTs);
        $lo = $n - 1;
        $hi = 0;
        $idxFloat = $lo + $t * ($hi - $lo);
        $idx = (int) round($idxFloat);
        if ($idx < 0) {
            $idx = 0;
        }
        if ($idx > $n - 1) {
            $idx = $n - 1;
        }

        return $ids[$idx];
    }

    // days mode
    $anchorDate = isset($task['auto_priority_anchor_date']) ? trim((string) $task['auto_priority_anchor_date']) : '';
    $anchorPri = isset($task['auto_priority_anchor_priority']) ? trim((string) $task['auto_priority_anchor_priority']) : '';
    if ($anchorDate === '' || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $anchorDate)) {
        return null;
    }
    if ($anchorPri === '' || !dt_is_allowed_priority($anchorPri, $layout)) {
        return null;
    }
    $step = isset($global['auto_priority_days_per_step'])
        ? (int) $global['auto_priority_days_per_step']
        : (isset($task['auto_priority_days_per_step']) ? (int) $task['auto_priority_days_per_step'] : 1);
    if ($step < 1) {
        $step = 1;
    }
    if ($step > 365) {
        $step = 365;
    }

    $anchorIdx = array_search($anchorPri, $ids, true);
    if ($anchorIdx === false) {
        return null;
    }
    $aTs = strtotime($anchorDate . ' 12:00:00 UTC');
    $todayTs = strtotime($todayYmd . ' 12:00:00 UTC');
    if ($aTs === false || $todayTs === false) {
        return null;
    }
    $days = (int) floor(($todayTs - $aTs) / 86400);
    if ($days < 0) {
        $days = 0;
    }
    $periods = intdiv($days, $step);
    $newIdx = $anchorIdx - $periods;
    if ($newIdx < 0) {
        $newIdx = 0;
    }

    return $ids[$newIdx];
}

/**
 * Apply auto priority to all enabled tasks for $todayYmd. Returns number of rows updated.
 *
 * @return int
 */
function dt_apply_auto_priorities(PDO $pdo, string $todayYmd)
{
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $todayYmd)) {
        return 0;
    }
    $colStmt = $pdo->query('PRAGMA table_info(tasks)');
    $colNames = $colStmt ? array_column($colStmt->fetchAll(PDO::FETCH_ASSOC), 'name') : [];
    if (!in_array('auto_priority_enabled', $colNames, true)) {
        return 0;
    }

    $layout = dt_task_layout_from_pdo($pdo);
    $global = dt_auto_priority_globals_from_pdo($pdo);
    $cols = 'id, priority, created_at, due_date, auto_priority_enabled, auto_priority_mode, auto_priority_days_per_step, auto_priority_anchor_date, auto_priority_anchor_priority';
    $stmt = $pdo->query("SELECT {$cols} FROM tasks WHERE COALESCE(auto_priority_enabled, 0) = 1");
    $rows = $stmt ? $stmt->fetchAll(PDO::FETCH_ASSOC) : [];
    $updated = 0;
    foreach ($rows as $row) {
        $slug = dt_compute_auto_priority_slug($layout, $row, $todayYmd, $global);
        if ($slug === null || $slug === (string) $row['priority']) {
            continue;
        }
        if (!dt_is_allowed_priority($slug, $layout)) {
            continue;
        }
        $u = $pdo->prepare('UPDATE tasks SET priority = ? WHERE id = ?');
        $u->execute([$slug, (int) $row['id']]);
        ++$updated;
    }

    return $updated;
}
