<?php
/**
 * Tasks API: GET list (unscheduled + optional day), POST create, PATCH update, DELETE.
 */
require_once __DIR__ . '/common.php';
require_once dirname(__DIR__) . '/lib/logger.php';

$pdo = getPdoSafe();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
logMessage('INFO', 'tasks.php branch', ['method' => $method, 'user_id' => $userId]);

if ($method === 'GET') {
    $listState = isset($_GET['list_state']) && in_array($_GET['list_state'], ['unassigned', 'pending'], true) ? $_GET['list_state'] : null;
    $view = isset($_GET['view']) && $_GET['view'] === 'incomplete' ? 'incomplete' : null;
    $viewDay = isset($_GET['day']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET['day']) ? $_GET['day'] : null;
    $with = isset($_GET['with']) ? trim((string) $_GET['with']) : '';
    $withLinks = $with !== '' && in_array('links', array_map('trim', explode(',', $with)), true);
    $withListItems = $with !== '' && in_array('list_items', array_map('trim', explode(',', $with)), true);
    $withOrganization = $with !== '' && in_array('organization', array_map('trim', explode(',', $with)), true);

    $taskIds = null;
    if ($view === 'incomplete' && $viewDay !== null) {
        $yesterday = date('Y-m-d', strtotime($viewDay . ' -1 day'));
        $dayStmt = $pdo->prepare("SELECT id FROM day_record WHERE date = ?");
        $dayStmt->execute([$yesterday]);
        $dayRow = $dayStmt->fetch(PDO::FETCH_ASSOC);
        if ($dayRow) {
            $yDayId = (int) $dayRow['id'];
            $slotStmt = $pdo->prepare("SELECT s.id, s.task_id, s.completed, t.parent_id FROM scheduled_slots s JOIN tasks t ON t.id = s.task_id WHERE s.day_record_id = ?");
            $slotStmt->execute([$yDayId]);
            $pastSlots = $slotStmt->fetchAll(PDO::FETCH_ASSOC);
            $pastByTaskId = [];
            foreach ($pastSlots as $s) {
                $pastByTaskId[(int) $s['task_id']] = $s;
            }
            $pastChildByParent = [];
            $pastRoots = [];
            foreach ($pastSlots as $s) {
                $pid = $s['parent_id'] !== null ? (int) $s['parent_id'] : null;
                if ($pid !== null && isset($pastByTaskId[$pid])) {
                    $pastChildByParent[$pid][] = $s;
                } else {
                    $pastRoots[] = $s;
                }
            }
            $incomplete = [];
            foreach ($pastRoots as $root) {
                $tid = (int) $root['task_id'];
                $children = $pastChildByParent[$tid] ?? [];
                if (count($children) === 0) continue;
                $allDone = (int) $root['completed'] === 1 && array_reduce($children, fn($c, $x) => $c && (int) $x['completed'] === 1, true);
                $noneDone = (int) $root['completed'] !== 1 && array_reduce($children, fn($c, $x) => $c && (int) $x['completed'] !== 1, true);
                if (!$allDone && !$noneDone) {
                    $incomplete[] = $tid;
                }
            }
            $taskIds = array_unique($incomplete);
        } else {
            $taskIds = [];
        }
    }

    $columns = 'id, title, priority, recurring, parent_id, created_at, list_state, list_style';
    $stmt = $pdo->query("PRAGMA table_info(tasks)");
    $cols = $stmt ? $stmt->fetchAll(PDO::FETCH_ASSOC) : [];
    if (in_array('recurrence_rule', array_column($cols, 'name'), true)) {
        $columns = 'id, title, priority, recurring, recurrence_rule, parent_id, created_at, list_state, list_style';
    }
    $sql = "SELECT {$columns} FROM tasks";
    $params = [];
    if ($taskIds !== null) {
        if (count($taskIds) === 0) {
            $rows = [];
            $out = ['tasks' => [], 'incompleteRootIds' => []];
            logMessage('INFO', 'tasks list ok', ['view' => 'incomplete', 'count' => 0]);
            jsonResponse($out);
            exit;
        }
        $placeholders = implode(',', array_fill(0, count($taskIds), '?'));
        $sql .= " WHERE id IN ({$placeholders}) ORDER BY parent_id IS NULL DESC, id ASC";
        $params = array_values($taskIds);
    } elseif ($listState !== null) {
        $sql .= " WHERE list_state = ?";
        $params[] = $listState;
        $sql .= " ORDER BY parent_id IS NULL DESC, id ASC";
    } else {
        $sql .= " ORDER BY parent_id IS NULL DESC, id ASC";
    }
    try {
        $stmt = $params === [] ? $pdo->query($sql) : $pdo->prepare($sql);
        if ($params !== []) {
            $stmt->execute($params);
        }
        $rows = $stmt ? $stmt->fetchAll(PDO::FETCH_ASSOC) : [];
    } catch (PDOException $e) {
        if (strpos($e->getMessage(), 'recurrence_rule') !== false && strpos($columns, 'recurrence_rule') !== false) {
            $columns = 'id, title, priority, recurring, parent_id, created_at, list_state, list_style';
            $sql = "SELECT {$columns} FROM tasks";
            if ($taskIds !== null && count($taskIds) > 0) {
                $ph = implode(',', array_fill(0, count($taskIds), '?'));
                $sql .= " WHERE id IN ({$ph}) ORDER BY parent_id IS NULL DESC, id ASC";
                $stmt = $pdo->prepare($sql);
                $stmt->execute(array_values($taskIds));
            } elseif ($listState !== null) {
                $sql .= " WHERE list_state = ? ORDER BY parent_id IS NULL DESC, id ASC";
                $stmt = $pdo->prepare($sql);
                $stmt->execute([$listState]);
            } else {
                $sql .= " ORDER BY parent_id IS NULL DESC, id ASC";
                $stmt = $pdo->query($sql);
            }
            $rows = $stmt ? $stmt->fetchAll(PDO::FETCH_ASSOC) : [];
        } else {
            throw $e;
        }
    }

    $out = ['tasks' => $rows];
    if ($view === 'incomplete' && $taskIds !== null) {
        $out['incompleteRootIds'] = array_values($taskIds);
    }
    if (($withLinks || $withListItems) && count($rows) > 0) {
        $taskIds = array_unique(array_column($rows, 'id'));
        if ($withLinks) {
            $placeholders = implode(',', array_fill(0, count($taskIds), '?'));
            $linkStmt = $pdo->prepare("SELECT id, task_id, url, description FROM task_links WHERE task_id IN ({$placeholders}) ORDER BY task_id, id");
            $linkStmt->execute(array_values($taskIds));
            $linkRows = $linkStmt->fetchAll(PDO::FETCH_ASSOC);
            $linksByTaskId = [];
            foreach ($linkRows as $r) {
                $tid = (int) $r['task_id'];
                if (!isset($linksByTaskId[$tid])) {
                    $linksByTaskId[$tid] = [];
                }
                $linksByTaskId[$tid][] = $r;
            }
            $out['linksByTaskId'] = $linksByTaskId;
        }
        if ($withListItems) {
            $placeholders = implode(',', array_fill(0, count($taskIds), '?'));
            $itemStmt = $pdo->prepare("SELECT id, task_id, content, order_index, completed FROM task_list_items WHERE task_id IN ({$placeholders}) ORDER BY task_id, order_index ASC, id ASC");
            $itemStmt->execute(array_values($taskIds));
            $itemRows = $itemStmt->fetchAll(PDO::FETCH_ASSOC);
            $listItemsByTaskId = [];
            foreach ($itemRows as $r) {
                $tid = (int) $r['task_id'];
                if (!isset($listItemsByTaskId[$tid])) {
                    $listItemsByTaskId[$tid] = [];
                }
                $listItemsByTaskId[$tid][] = $r;
            }
            $out['listItemsByTaskId'] = $listItemsByTaskId;
        }
    }
    if ($withOrganization && count($rows) > 0) {
        $check = $pdo->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_category'");
        if ($check && $check->fetchColumn()) {
            $taskIds = array_column($rows, 'id');
            $placeholders = implode(',', array_fill(0, count($taskIds), '?'));
            $catStmt = $pdo->prepare("SELECT task_id, category_id FROM task_category WHERE task_id IN ({$placeholders})");
            $catStmt->execute(array_values($taskIds));
            $catByTask = [];
            while ($r = $catStmt->fetch(PDO::FETCH_ASSOC)) {
                $catByTask[(int) $r['task_id']] = (int) $r['category_id'];
            }
            $subStmt = $pdo->prepare("SELECT task_id, subcategory_id FROM task_subcategory WHERE task_id IN ({$placeholders})");
            $subStmt->execute(array_values($taskIds));
            $subByTask = [];
            while ($r = $subStmt->fetch(PDO::FETCH_ASSOC)) {
                $subByTask[(int) $r['task_id']] = (int) $r['subcategory_id'];
            }
            $tagStmt = $pdo->prepare("SELECT task_id, tag_id FROM task_tag WHERE task_id IN ({$placeholders}) ORDER BY task_id, tag_id");
            $tagStmt->execute(array_values($taskIds));
            $tagsByTask = [];
            while ($r = $tagStmt->fetch(PDO::FETCH_ASSOC)) {
                $tid = (int) $r['task_id'];
                if (!isset($tagsByTask[$tid])) {
                    $tagsByTask[$tid] = [];
                }
                $tagsByTask[$tid][] = (int) $r['tag_id'];
            }
            foreach ($out['tasks'] as &$t) {
                $tid = (int) $t['id'];
                $t['category_id'] = $catByTask[$tid] ?? null;
                $t['subcategory_id'] = $subByTask[$tid] ?? null;
                $t['tag_ids'] = $tagsByTask[$tid] ?? [];
            }
            unset($t);
        }
    }
    logMessage('INFO', 'tasks list ok', ['count' => count($rows), 'list_state' => $listState, 'with' => $with]);
    jsonResponse($out);
    exit;
}

if ($method === 'POST') {
    logMessage('INFO', 'tasks POST create');
    $in = readJsonInput();
    if (!$in || empty($in['title'])) {
        logMessage('WARNING', 'tasks create validation failed', ['error' => 'title required']);
        jsonError('title required');
        exit;
    }
    $title = trim($in['title']);
    $priority = isset($in['priority']) && in_array($in['priority'], ['commitment', 'high', 'medium', 'low'], true) ? $in['priority'] : 'medium';
    $recurring = !empty($in['recurring']) ? 1 : 0;
    $parentId = isset($in['parent_id']) ? (int) $in['parent_id'] : null;
    $listStyle = isset($in['list_style']) && $in['list_style'] === 'checklist' ? 'checklist' : 'bullet';
    $stmt = $pdo->prepare("INSERT INTO tasks (title, priority, recurring, parent_id, list_style) VALUES (?, ?, ?, ?, ?)");
    $stmt->execute([$title, $priority, $recurring, $parentId ?: null, $listStyle]);
    $id = (int) $pdo->lastInsertId();
    if ($recurring === 1) {
        $colStmt = $pdo->query("PRAGMA table_info(tasks)");
        $colNames = $colStmt ? array_column($colStmt->fetchAll(PDO::FETCH_ASSOC), 'name') : [];
        if (in_array('recurrence_rule', $colNames, true)) {
            $dailyDefault = '{"freq":"daily","time":"09:00"}';
            $pdo->prepare("UPDATE tasks SET recurrence_rule = ? WHERE id = ?")->execute([$dailyDefault, $id]);
        }
    }
    logMessage('INFO', 'tasks create ok', ['id' => $id]);
    jsonResponse(['id' => $id, 'title' => $title, 'priority' => $priority, 'recurring' => (bool) $recurring, 'parent_id' => $parentId, 'list_state' => 'unassigned', 'list_style' => $listStyle]);
    exit;
}

if ($method === 'PATCH') {
    logMessage('INFO', 'tasks PATCH update');
    $in = readJsonInput();
    $id = isset($in['id']) ? (int) $in['id'] : 0;
    if ($id < 1) {
        logMessage('WARNING', 'tasks update validation failed', ['error' => 'id required']);
        jsonError('id required');
        exit;
    }
    $updates = [];
    $params = [];
    if (array_key_exists('title', $in)) {
        $updates[] = 'title = ?';
        $params[] = trim($in['title']);
    }
    if (array_key_exists('priority', $in) && in_array($in['priority'], ['commitment', 'high', 'medium', 'low'], true)) {
        $updates[] = 'priority = ?';
        $params[] = $in['priority'];
    }
    if (array_key_exists('recurring', $in)) {
        $updates[] = 'recurring = ?';
        $params[] = !empty($in['recurring']) ? 1 : 0;
        if (!empty($in['recurring'])) {
            $colStmt = $pdo->query("PRAGMA table_info(tasks)");
            $colNames = $colStmt ? array_column($colStmt->fetchAll(PDO::FETCH_ASSOC), 'name') : [];
            if (in_array('recurrence_rule', $colNames, true) && !array_key_exists('recurrence_rule', $in)) {
                $updates[] = 'recurrence_rule = COALESCE(NULLIF(trim(recurrence_rule), ""), ?)';
                $params[] = '{"freq":"daily","time":"09:00"}';
            }
        }
    }
    if (array_key_exists('recurrence_rule', $in)) {
        $colStmt = $pdo->query("PRAGMA table_info(tasks)");
        $colNames = $colStmt ? array_column($colStmt->fetchAll(PDO::FETCH_ASSOC), 'name') : [];
        if (in_array('recurrence_rule', $colNames, true)) {
            $updates[] = 'recurrence_rule = ?';
            $params[] = is_string($in['recurrence_rule']) ? $in['recurrence_rule'] : null;
            logMessage('INFO', 'tasks PATCH recurrence_rule', ['id' => $id, 'len' => is_string($in['recurrence_rule']) ? strlen($in['recurrence_rule']) : 0]);
        }
    }
    if (array_key_exists('parent_id', $in)) {
        $updates[] = 'parent_id = ?';
        $params[] = $in['parent_id'] === null || $in['parent_id'] === '' ? null : (int) $in['parent_id'];
    }
    if (array_key_exists('list_state', $in) && in_array($in['list_state'], ['unassigned', 'pending'], true)) {
        $updates[] = 'list_state = ?';
        $params[] = $in['list_state'];
    }
    if (array_key_exists('list_style', $in) && in_array($in['list_style'], ['bullet', 'checklist'], true)) {
        $updates[] = 'list_style = ?';
        $params[] = $in['list_style'];
    }
    $hasOrgTables = $pdo->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_category'")->fetchColumn();
    $hasOrgUpdates = $hasOrgTables && (array_key_exists('category_id', $in) || array_key_exists('subcategory_id', $in) || (array_key_exists('tag_ids', $in) && is_array($in['tag_ids'])));
    if (empty($updates) && !$hasOrgUpdates) {
        logMessage('WARNING', 'tasks update no fields', ['id' => $id]);
        jsonError('No fields to update');
        exit;
    }
    if (!empty($updates)) {
        $params[] = $id;
        $sql = "UPDATE tasks SET " . implode(', ', $updates) . " WHERE id = ?";
        try {
            $pdo->prepare($sql)->execute($params);
        } catch (PDOException $e) {
            $settingCommitment = array_key_exists('priority', $in) && ($in['priority'] ?? '') === 'commitment';
            if ($settingCommitment) {
                jsonError('Priority "commitment" requires a database update. Please run migrations (e.g. visit Settings or re-run install).', 400);
                exit;
            }
            throw $e;
        }
    }
    $cols = 'id, title, priority, recurring, parent_id, created_at, list_state, list_style';
    $colStmt = $pdo->query("PRAGMA table_info(tasks)");
    $colNames = $colStmt ? array_column($colStmt->fetchAll(PDO::FETCH_ASSOC), 'name') : [];
    if (in_array('recurrence_rule', $colNames, true)) {
        $cols .= ', recurrence_rule';
    }
    $sel = $pdo->prepare("SELECT {$cols} FROM tasks WHERE id = ?");
    $sel->execute([$id]);
    $task = $sel->fetch(PDO::FETCH_ASSOC);

    if ($hasOrgTables) {
        if (array_key_exists('category_id', $in)) {
            $cid = $in['category_id'] === null || $in['category_id'] === '' ? null : (int) $in['category_id'];
            $pdo->prepare("INSERT OR REPLACE INTO task_category (task_id, category_id) VALUES (?, ?)")->execute([$id, $cid]);
        }
        if (array_key_exists('subcategory_id', $in)) {
            $sid = $in['subcategory_id'] === null || $in['subcategory_id'] === '' ? null : (int) $in['subcategory_id'];
            $pdo->prepare("INSERT OR REPLACE INTO task_subcategory (task_id, subcategory_id) VALUES (?, ?)")->execute([$id, $sid]);
        }
        if (array_key_exists('tag_ids', $in) && is_array($in['tag_ids'])) {
            $pdo->prepare("DELETE FROM task_tag WHERE task_id = ?")->execute([$id]);
            $tagIns = $pdo->prepare("INSERT INTO task_tag (task_id, tag_id) VALUES (?, ?)");
            foreach (array_map('intval', $in['tag_ids']) as $tid) {
                if ($tid > 0) {
                    $tagIns->execute([$id, $tid]);
                }
            }
        }
    }

    logMessage('INFO', 'tasks update ok', ['id' => $id]);
    jsonResponse(['ok' => true, 'task' => $task]);
    exit;
}

if ($method === 'DELETE') {
    logMessage('INFO', 'tasks DELETE');
    $id = isset($_GET['id']) ? (int) $_GET['id'] : 0;
    if ($id < 1) {
        logMessage('WARNING', 'tasks delete validation failed', ['error' => 'id required']);
        jsonError('id required');
        exit;
    }
    $pdo->prepare("DELETE FROM tasks WHERE id = ?")->execute([$id]);
    logMessage('INFO', 'tasks delete ok', ['id' => $id]);
    jsonResponse(['ok' => true]);
    exit;
}

logMessage('WARNING', 'tasks method not allowed', ['method' => $method]);
jsonError('Method not allowed', 405);
