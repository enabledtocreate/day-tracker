<?php
/**
 * Tasks API: GET list (unscheduled + optional day), POST create, PATCH update, DELETE.
 */
require_once __DIR__ . '/common.php';
require_once dirname(__DIR__) . '/lib/logger.php';
require_once dirname(__DIR__) . '/lib/task_layout.php';
require_once dirname(__DIR__) . '/lib/data_revision.php';

$pdo = getPdoSafe();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
logMessage('INFO', 'tasks.php branch', ['method' => $method, 'user_id' => $userId]);

if ($method === 'GET') {
    $layoutGet = dt_task_layout_from_pdo($pdo);
    $listState = isset($_GET['list_state']) && in_array((string) $_GET['list_state'], $layoutGet['bucket_ids'], true) ? (string) $_GET['list_state'] : null;
    $view = isset($_GET['view']) && $_GET['view'] === 'incomplete' ? 'incomplete' : null;
    $viewDay = isset($_GET['day']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET['day']) ? $_GET['day'] : null;
    $commonOnly = isset($_GET['common']) && ($_GET['common'] === '1' || $_GET['common'] === 'true');
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
    $hasDueDate = in_array('due_date', array_column($cols, 'name'), true);
    if (in_array('recurrence_rule', array_column($cols, 'name'), true)) {
        $columns = 'id, title, priority, recurring, recurrence_rule, parent_id, created_at, list_state, list_style';
    }
    if ($hasDueDate) {
        $columns .= ', due_date';
    }
    $hasGroupOrder = in_array('group_order', array_column($cols, 'name'), true);
    if ($hasGroupOrder) {
        $columns .= ', group_order';
    }
    $hasIsCommon = in_array('is_common', array_column($cols, 'name'), true);
    if ($hasIsCommon) {
        $columns .= ', is_common';
    }
    $hasAutoCompleteEod = in_array('auto_complete_eod', array_column($cols, 'name'), true);
    if ($hasAutoCompleteEod) {
        $columns .= ', auto_complete_eod';
    }
    $hasFavoriteFolderId = in_array('favorite_folder_id', array_column($cols, 'name'), true);
    if ($hasFavoriteFolderId) {
        $columns .= ', favorite_folder_id';
    }
    $hasAutoPri = in_array('auto_priority_enabled', array_column($cols, 'name'), true);
    if ($hasAutoPri) {
        $columns .= ', auto_priority_enabled, auto_priority_mode, auto_priority_days_per_step, auto_priority_anchor_date, auto_priority_anchor_priority';
    }
    $hasDefaultBlock = in_array('default_block_id', array_column($cols, 'name'), true);
    if ($hasDefaultBlock) {
        $columns .= ', default_block_id, default_duration_intervals';
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
        if ($hasGroupOrder) {
            $sql .= " WHERE id IN ({$placeholders}) ORDER BY parent_id IS NULL DESC, COALESCE(parent_id, -1) ASC, group_order ASC, id ASC";
        } else {
            $sql .= " WHERE id IN ({$placeholders}) ORDER BY parent_id IS NULL DESC, id ASC";
        }
        $params = array_values($taskIds);
    } elseif ($commonOnly && $hasIsCommon) {
        $sql .= " WHERE COALESCE(is_common, 0) = 1 AND parent_id IS NULL";
        if ($hasGroupOrder) {
            $sql .= " ORDER BY group_order ASC, id ASC";
        } else {
            $sql .= " ORDER BY id ASC";
        }
    } elseif ($listState !== null) {
        $sql .= " WHERE list_state = ?";
        $params[] = $listState;
        if ($hasIsCommon) {
            $sql .= " AND COALESCE(is_common, 0) = 0";
        }
        if ($hasGroupOrder) {
            $sql .= " ORDER BY parent_id IS NULL DESC, COALESCE(parent_id, -1) ASC, group_order ASC, id ASC";
        } else {
            $sql .= " ORDER BY parent_id IS NULL DESC, id ASC";
        }
    } else {
        if ($hasGroupOrder) {
            $sql .= " ORDER BY parent_id IS NULL DESC, COALESCE(parent_id, -1) ASC, group_order ASC, id ASC";
        } else {
            $sql .= " ORDER BY parent_id IS NULL DESC, id ASC";
        }
    }
    $rows = [];
    if (!($commonOnly && !$hasIsCommon)) {
    try {
        $stmt = $params === [] ? $pdo->query($sql) : $pdo->prepare($sql);
        if ($params !== []) {
            $stmt->execute($params);
        }
        $rows = $stmt ? $stmt->fetchAll(PDO::FETCH_ASSOC) : [];
    } catch (PDOException $e) {
        if (strpos($e->getMessage(), 'recurrence_rule') !== false && strpos($columns, 'recurrence_rule') !== false) {
            logMessage('NOTICE', 'tasks list: retrying without recurrence_rule column', ['message' => $e->getMessage()]);
            $columns = 'id, title, priority, recurring, parent_id, created_at, list_state, list_style';
            if ($hasGroupOrder) {
                $columns .= ', group_order';
            }
            $sql = "SELECT {$columns} FROM tasks";
            if ($taskIds !== null && count($taskIds) > 0) {
                $ph = implode(',', array_fill(0, count($taskIds), '?'));
                if ($hasGroupOrder) {
                    $sql .= " WHERE id IN ({$ph}) ORDER BY parent_id IS NULL DESC, COALESCE(parent_id, -1) ASC, group_order ASC, id ASC";
                } else {
                    $sql .= " WHERE id IN ({$ph}) ORDER BY parent_id IS NULL DESC, id ASC";
                }
                $stmt = $pdo->prepare($sql);
                $stmt->execute(array_values($taskIds));
            } elseif ($commonOnly && $hasIsCommon) {
                $sql .= " WHERE COALESCE(is_common, 0) = 1 AND parent_id IS NULL";
                if ($hasGroupOrder) {
                    $sql .= " ORDER BY group_order ASC, id ASC";
                } else {
                    $sql .= " ORDER BY id ASC";
                }
                $stmt = $pdo->query($sql);
            } elseif ($listState !== null) {
                if ($hasGroupOrder) {
                    $sql .= " WHERE list_state = ?";
                    if ($hasIsCommon) {
                        $sql .= " AND COALESCE(is_common, 0) = 0";
                    }
                    $sql .= " ORDER BY parent_id IS NULL DESC, COALESCE(parent_id, -1) ASC, group_order ASC, id ASC";
                } else {
                    $sql .= " WHERE list_state = ?";
                    if ($hasIsCommon) {
                        $sql .= " AND COALESCE(is_common, 0) = 0";
                    }
                    $sql .= " ORDER BY parent_id IS NULL DESC, id ASC";
                }
                $stmt = $pdo->prepare($sql);
                $stmt->execute([$listState]);
            } else {
                if ($hasGroupOrder) {
                    $sql .= " ORDER BY parent_id IS NULL DESC, COALESCE(parent_id, -1) ASC, group_order ASC, id ASC";
                } else {
                    $sql .= " ORDER BY parent_id IS NULL DESC, id ASC";
                }
                $stmt = $pdo->query($sql);
            }
            $rows = $stmt ? $stmt->fetchAll(PDO::FETCH_ASSOC) : [];
        } else {
            throw $e;
        }
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
    if (!$in) {
        jsonError('Invalid JSON');
        exit;
    }

    $layoutPost = dt_task_layout_from_pdo($pdo);
    $defaultListState = $layoutPost['bucket_ids'][0] ?? 'unassigned';

    $colStmtPost = $pdo->query("PRAGMA table_info(tasks)");
    $colNamesPost = $colStmtPost ? array_column($colStmtPost->fetchAll(PDO::FETCH_ASSOC), 'name') : [];
    $hasIsCommonPost = in_array('is_common', $colNamesPost, true);
    $hasGroupOrderPost = in_array('group_order', $colNamesPost, true);

    $copyFrom = isset($in['copy_from']) ? (int) $in['copy_from'] : 0;
    if ($copyFrom > 0) {
        $ls = isset($in['list_state']) && in_array((string) $in['list_state'], $layoutPost['bucket_ids'], true) ? (string) $in['list_state'] : $defaultListState;
        $selCols = 'id, title, priority, recurring, parent_id, created_at, list_state, list_style';
        if (in_array('recurrence_rule', $colNamesPost, true)) {
            $selCols .= ', recurrence_rule';
        }
        if (in_array('due_date', $colNamesPost, true)) {
            $selCols .= ', due_date';
        }
        if ($hasGroupOrderPost) {
            $selCols .= ', group_order';
        }
        if ($hasIsCommonPost) {
            $selCols .= ', is_common';
        }
        if (in_array('auto_complete_eod', $colNamesPost, true)) {
            $selCols .= ', auto_complete_eod';
        }
        if (in_array('auto_priority_enabled', $colNamesPost, true)) {
            $selCols .= ', auto_priority_enabled';
        }
        if (in_array('default_block_id', $colNamesPost, true)) {
            $selCols .= ', default_block_id, default_duration_intervals';
        }
        $srcStmt = $pdo->prepare("SELECT {$selCols} FROM tasks WHERE id = ?");
        $srcStmt->execute([$copyFrom]);
        $src = $srcStmt->fetch(PDO::FETCH_ASSOC);
        if (!$src) {
            jsonError('copy_from task not found', 404);
            exit;
        }
        $title = trim((string) $src['title']);
        if (!empty($in['title'])) {
            $title = trim((string) $in['title']);
        }
        $fallbackCopyP = in_array('medium', $layoutPost['priority_ids'], true) ? 'medium' : ($layoutPost['priority_ids'][0] ?? 'medium');
        $priority = isset($src['priority']) && dt_is_allowed_priority((string) $src['priority'], $layoutPost)
            ? (string) $src['priority']
            : $fallbackCopyP;
        if (isset($in['priority']) && dt_is_allowed_priority((string) $in['priority'], $layoutPost)) {
            $priority = (string) $in['priority'];
        }
        $listStyle = ($src['list_style'] ?? 'bullet') === 'checklist' ? 'checklist' : 'bullet';
        if ($hasIsCommonPost) {
            $g = $hasGroupOrderPost ? ', group_order' : '';
            $gv = $hasGroupOrderPost ? ', 0' : '';
            $ins = $pdo->prepare("INSERT INTO tasks (title, priority, recurring, parent_id, list_style, list_state, is_common{$g}) VALUES (?, ?, 0, NULL, ?, ?, 0{$gv})");
            $ins->execute([$title, $priority, $listStyle, $ls]);
        } else {
            $ins = $pdo->prepare("INSERT INTO tasks (title, priority, recurring, parent_id, list_style, list_state) VALUES (?, ?, 0, NULL, ?, ?)");
            $ins->execute([$title, $priority, $listStyle, $ls]);
        }
        $newId = (int) $pdo->lastInsertId();
        if (in_array('recurrence_rule', $colNamesPost, true)) {
            $pdo->prepare("UPDATE tasks SET recurrence_rule = NULL WHERE id = ?")->execute([$newId]);
        }
        $linkRows = $pdo->prepare("SELECT url, description FROM task_links WHERE task_id = ?");
        $linkRows->execute([$copyFrom]);
        $liIns = $pdo->prepare("INSERT INTO task_links (task_id, url, description) VALUES (?, ?, ?)");
        foreach ($linkRows->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $liIns->execute([$newId, $r['url'], $r['description'] ?? '']);
        }
        $itemRows = $pdo->prepare("SELECT content, order_index, completed FROM task_list_items WHERE task_id = ? ORDER BY order_index ASC, id ASC");
        $itemRows->execute([$copyFrom]);
        $itIns = $pdo->prepare("INSERT INTO task_list_items (task_id, content, order_index, completed) VALUES (?, ?, ?, ?)");
        foreach ($itemRows->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $itIns->execute([$newId, $r['content'] ?? '', (int) $r['order_index'], (int) ($r['completed'] ?? 0)]);
        }
        $orgOk = $pdo->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_category'")->fetchColumn();
        if ($orgOk) {
            $c = $pdo->prepare("SELECT category_id FROM task_category WHERE task_id = ?");
            $c->execute([$copyFrom]);
            $cr = $c->fetch(PDO::FETCH_ASSOC);
            if ($cr && isset($cr['category_id']) && $cr['category_id'] !== null) {
                $pdo->prepare("INSERT OR REPLACE INTO task_category (task_id, category_id) VALUES (?, ?)")->execute([$newId, (int) $cr['category_id']]);
            }
            $s = $pdo->prepare("SELECT subcategory_id FROM task_subcategory WHERE task_id = ?");
            $s->execute([$copyFrom]);
            $sr = $s->fetch(PDO::FETCH_ASSOC);
            if ($sr && isset($sr['subcategory_id']) && $sr['subcategory_id'] !== null) {
                $pdo->prepare("INSERT OR REPLACE INTO task_subcategory (task_id, subcategory_id) VALUES (?, ?)")->execute([$newId, (int) $sr['subcategory_id']]);
            }
            $pdo->prepare("DELETE FROM task_tag WHERE task_id = ?")->execute([$newId]);
            $tags = $pdo->prepare("SELECT tag_id FROM task_tag WHERE task_id = ?");
            $tags->execute([$copyFrom]);
            $tIns = $pdo->prepare("INSERT INTO task_tag (task_id, tag_id) VALUES (?, ?)");
            foreach ($tags->fetchAll(PDO::FETCH_ASSOC) as $tr) {
                $tIns->execute([$newId, (int) $tr['tag_id']]);
            }
        }
        if (in_array('due_date', $colNamesPost, true) && isset($src['due_date']) && $src['due_date'] !== null && $src['due_date'] !== '') {
            $pdo->prepare('UPDATE tasks SET due_date = ? WHERE id = ?')->execute([(string) $src['due_date'], $newId]);
        }
        if (in_array('auto_complete_eod', $colNamesPost, true) && isset($src['auto_complete_eod'])) {
            $pdo->prepare('UPDATE tasks SET auto_complete_eod = ? WHERE id = ?')->execute([(int) $src['auto_complete_eod'], $newId]);
        }
        if (in_array('auto_priority_enabled', $colNamesPost, true) && isset($src['auto_priority_enabled'])) {
            $pdo->prepare('UPDATE tasks SET auto_priority_enabled = ? WHERE id = ?')->execute([(int) $src['auto_priority_enabled'], $newId]);
        }
        if (in_array('default_block_id', $colNamesPost, true) && isset($src['default_block_id']) && $src['default_block_id'] !== null && $src['default_block_id'] !== '') {
            $pdo->prepare('UPDATE tasks SET default_block_id = ?, default_duration_intervals = ? WHERE id = ?')->execute([
                (int) $src['default_block_id'],
                max(1, (int) ($src['default_duration_intervals'] ?? 1)),
                $newId,
            ]);
        }
        logMessage('INFO', 'tasks POST copy_from ok', ['from' => $copyFrom, 'id' => $newId]);
        $outCopy = ['id' => $newId, 'title' => $title, 'priority' => $priority, 'recurring' => false, 'parent_id' => null, 'list_state' => $ls, 'list_style' => $listStyle];
        if ($hasIsCommonPost) {
            $outCopy['is_common'] = false;
        }
        jsonResponse($outCopy);
        exit;
    }

    if (empty($in['title'])) {
        logMessage('WARNING', 'tasks create validation failed', ['error' => 'title required']);
        jsonError('title required');
        exit;
    }
    $title = trim($in['title']);
    $fallbackNewP = in_array('low', $layoutPost['priority_ids'], true)
        ? 'low'
        : ($layoutPost['priority_ids'][count($layoutPost['priority_ids']) - 1] ?? 'medium');
    $priority = isset($in['priority']) && dt_is_allowed_priority((string) $in['priority'], $layoutPost)
        ? (string) $in['priority']
        : $fallbackNewP;
    $recurring = !empty($in['recurring']) ? 1 : 0;
    $parentId = isset($in['parent_id']) ? (int) $in['parent_id'] : null;
    $listStyle = isset($in['list_style']) && $in['list_style'] === 'checklist' ? 'checklist' : 'bullet';
    $isCommonNew = ($hasIsCommonPost && !empty($in['is_common'])) ? 1 : 0;
    if ($isCommonNew === 1 && $parentId) {
        jsonError('Common task must be a root (no parent_id)', 400);
        exit;
    }

    $dueDate = null;
    if (array_key_exists('due_date', $in)) {
        $raw = $in['due_date'];
        if ($raw === null || $raw === '') {
            $dueDate = null;
        } else {
            $s = trim((string) $raw);
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $s)) {
                jsonError('due_date must be YYYY-MM-DD or null', 400);
                exit;
            }
            $dueDate = $s;
        }
    }
    if ($hasIsCommonPost) {
        $stmt = $pdo->prepare("INSERT INTO tasks (title, priority, recurring, parent_id, list_style, is_common) VALUES (?, ?, ?, ?, ?, ?)");
        $stmt->execute([$title, $priority, $recurring, $parentId ?: null, $listStyle, $isCommonNew]);
    } else {
        $stmt = $pdo->prepare("INSERT INTO tasks (title, priority, recurring, parent_id, list_style) VALUES (?, ?, ?, ?, ?)");
        $stmt->execute([$title, $priority, $recurring, $parentId ?: null, $listStyle]);
    }
    $id = (int) $pdo->lastInsertId();

    if ($dueDate !== null) {
        $colStmt = $pdo->query("PRAGMA table_info(tasks)");
        $colNames = $colStmt ? array_column($colStmt->fetchAll(PDO::FETCH_ASSOC), 'name') : [];
        if (in_array('due_date', $colNames, true)) {
            $pdo->prepare("UPDATE tasks SET due_date = ? WHERE id = ?")->execute([$dueDate, $id]);
        }
    }
    if ($recurring === 1) {
        $colStmt = $pdo->query("PRAGMA table_info(tasks)");
        $colNames = $colStmt ? array_column($colStmt->fetchAll(PDO::FETCH_ASSOC), 'name') : [];
        if (in_array('recurrence_rule', $colNames, true)) {
            $dailyDefault = '{"freq":"daily","time":"09:00"}';
            $pdo->prepare("UPDATE tasks SET recurrence_rule = ? WHERE id = ?")->execute([$dailyDefault, $id]);
        }
    }
    $hasFavoriteFolderPost = in_array('favorite_folder_id', $colNamesPost, true);
    if ($hasFavoriteFolderPost && $isCommonNew === 1 && array_key_exists('favorite_folder_id', $in)) {
        $rawFf = $in['favorite_folder_id'];
        if ($rawFf === null || $rawFf === '' || $rawFf === false) {
            // leave NULL
        } else {
            $fid = (int) $rawFf;
            if ($fid > 0) {
                $ffTable = $pdo->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='favorite_folder'")->fetchColumn();
                if ($ffTable) {
                    $chk = $pdo->prepare('SELECT 1 FROM favorite_folder WHERE id = ?');
                    $chk->execute([$fid]);
                    if ($chk->fetchColumn()) {
                        $pdo->prepare('UPDATE tasks SET favorite_folder_id = ? WHERE id = ?')->execute([$fid, $id]);
                    }
                }
            }
        }
    }
    logMessage('INFO', 'tasks create ok', ['id' => $id]);
    $outCreate = ['id' => $id, 'title' => $title, 'priority' => $priority, 'recurring' => (bool) $recurring, 'parent_id' => $parentId, 'list_state' => $defaultListState, 'list_style' => $listStyle];
    if ($hasIsCommonPost) {
        $outCreate['is_common'] = (bool) $isCommonNew;
    }
    jsonResponse($outCreate);
    exit;
}

if ($method === 'PATCH') {
    logMessage('INFO', 'tasks PATCH update');
    $in = readJsonInput();
    $layoutPatch = dt_task_layout_from_pdo($pdo);
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
    if (array_key_exists('priority', $in) && dt_is_allowed_priority((string) $in['priority'], $layoutPatch)) {
        $updates[] = 'priority = ?';
        $params[] = (string) $in['priority'];
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
    $colStmt = $pdo->query("PRAGMA table_info(tasks)");
    $colNames = $colStmt ? array_column($colStmt->fetchAll(PDO::FETCH_ASSOC), 'name') : [];
    $hasGroupOrderPatch = in_array('group_order', $colNames, true);
    $hasDueDatePatch = in_array('due_date', $colNames, true);

    if (array_key_exists('parent_id', $in)) {
        $newParentId = $in['parent_id'] === null || $in['parent_id'] === '' ? null : (int) $in['parent_id'];
        $updates[] = 'parent_id = ?';
        $params[] = $newParentId;

        // When tasks are grouped under a new parent, assign stable group_order automatically.
        if ($hasGroupOrderPatch) {
            if ($newParentId === null) {
                // Ungroup: reset order so it doesn't interfere with other groups.
                $updates[] = 'group_order = ?';
                $params[] = 0;
            } else {
                // First child should become group_order=0, then 1, 2, ...
                $nextOrderStmt = $pdo->prepare("SELECT COALESCE(MAX(group_order), -1) + 1 AS next_order FROM tasks WHERE parent_id = ?");
                $nextOrderStmt->execute([$newParentId]);
                $nextOrder = (int) ($nextOrderStmt->fetchColumn() ?? 0);
                $updates[] = 'group_order = ?';
                $params[] = $nextOrder;
            }
        }
        if ($newParentId !== null && !array_key_exists('list_state', $in)) {
            $parentLsStmt = $pdo->prepare('SELECT list_state FROM tasks WHERE id = ?');
            $parentLsStmt->execute([$newParentId]);
            $parentLsRow = $parentLsStmt->fetch(PDO::FETCH_ASSOC);
            if (
                $parentLsRow
                && isset($parentLsRow['list_state'])
                && dt_is_allowed_list_state((string) $parentLsRow['list_state'], $layoutPatch)
            ) {
                $updates[] = 'list_state = ?';
                $params[] = (string) $parentLsRow['list_state'];
            }
        }
    }

    if (array_key_exists('group_order', $in) && $hasGroupOrderPatch) {
        $go = (int) $in['group_order'];
        if ($go < 0) $go = 0;
        $updates[] = 'group_order = ?';
        $params[] = $go;
    }
    if (array_key_exists('list_state', $in) && dt_is_allowed_list_state((string) $in['list_state'], $layoutPatch)) {
        $updates[] = 'list_state = ?';
        $params[] = (string) $in['list_state'];
    }
    if (array_key_exists('list_style', $in) && in_array($in['list_style'], ['bullet', 'checklist'], true)) {
        $updates[] = 'list_style = ?';
        $params[] = $in['list_style'];
    }
    $hasIsCommonPatch = in_array('is_common', $colNames, true);
    if (array_key_exists('is_common', $in) && $hasIsCommonPatch) {
        $v = !empty($in['is_common']) ? 1 : 0;
        if ($v === 1) {
            $selfRow = $pdo->prepare('SELECT parent_id FROM tasks WHERE id = ?');
            $selfRow->execute([$id]);
            $self = $selfRow->fetch(PDO::FETCH_ASSOC);
            if ($self && $self['parent_id'] !== null && $self['parent_id'] !== '') {
                jsonError('Cannot mark grouped task as common', 400);
                exit;
            }
            $kidStmt = $pdo->prepare('SELECT 1 FROM tasks WHERE parent_id = ? LIMIT 1');
            $kidStmt->execute([$id]);
            if ($kidStmt->fetchColumn()) {
                jsonError('Cannot mark group root with children as common', 400);
                exit;
            }
        }
        $updates[] = 'is_common = ?';
        $params[] = $v;
    }

    // Per-task: auto-complete uncompleted slots at end of day (client-driven, see TODO-mobile §0.7).
    $hasAutoCompleteEodPatch = in_array('auto_complete_eod', $colNames, true);
    if (array_key_exists('auto_complete_eod', $in) && $hasAutoCompleteEodPatch) {
        $v = !empty($in['auto_complete_eod']) ? 1 : 0;
        $updates[] = 'auto_complete_eod = ?';
        $params[] = $v;
    }

    $hasFavoriteFolderIdPatch = in_array('favorite_folder_id', $colNames, true);
    if (array_key_exists('favorite_folder_id', $in) && $hasFavoriteFolderIdPatch) {
        $selfCommon = $pdo->prepare('SELECT COALESCE(is_common, 0) AS ic, parent_id FROM tasks WHERE id = ?');
        $selfCommon->execute([$id]);
        $sc = $selfCommon->fetch(PDO::FETCH_ASSOC);
        if (!$sc || (int) $sc['ic'] !== 1 || $sc['parent_id'] !== null && $sc['parent_id'] !== '') {
            jsonError('favorite_folder_id only applies to favorite (common) root tasks', 400);
            exit;
        }
        $rawFf = $in['favorite_folder_id'];
        if ($rawFf === null || $rawFf === '' || $rawFf === false) {
            $updates[] = 'favorite_folder_id = NULL';
        } else {
            $fid = (int) $rawFf;
            if ($fid < 1) {
                jsonError('favorite_folder_id must be positive or null', 400);
                exit;
            }
            $fok = $pdo->prepare('SELECT 1 FROM favorite_folder WHERE id = ?');
            $fok->execute([$fid]);
            if (!$fok->fetchColumn()) {
                jsonError('favorite_folder not found', 404);
                exit;
            }
            $updates[] = 'favorite_folder_id = ?';
            $params[] = $fid;
        }
    }

    if (array_key_exists('due_date', $in) && $hasDueDatePatch) {
        $raw = $in['due_date'];
        if ($raw === null || $raw === '') {
            $dueDate = null;
        } else {
            $s = trim((string) $raw);
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $s)) {
                jsonError('due_date must be YYYY-MM-DD or null', 400);
                exit;
            }
            $dueDate = $s;
        }
        $updates[] = 'due_date = ?';
        $params[] = $dueDate;
    }
    $hasDefaultBlockPatch = in_array('default_block_id', $colNames, true);
    if ($hasDefaultBlockPatch && array_key_exists('default_block_id', $in)) {
        $rawBlock = $in['default_block_id'];
        if ($rawBlock === null || $rawBlock === '' || $rawBlock === false) {
            $updates[] = 'default_block_id = NULL';
        } else {
            $bid = (int) $rawBlock;
            if ($bid < 1) {
                jsonError('default_block_id must be positive or null', 400);
                exit;
            }
            $bok = $pdo->prepare('SELECT 1 FROM task_blocks WHERE id = ?');
            $bok->execute([$bid]);
            if (!$bok->fetchColumn()) {
                jsonError('task block not found', 404);
                exit;
            }
            $updates[] = 'default_block_id = ?';
            $params[] = $bid;
        }
    }
    if ($hasDefaultBlockPatch && array_key_exists('default_duration_intervals', $in)) {
        $intervals = max(1, (int) $in['default_duration_intervals']);
        $updates[] = 'default_duration_intervals = ?';
        $params[] = $intervals;
    }
    $hasAutoPriPatch = in_array('auto_priority_enabled', $colNames, true);
    if ($hasAutoPriPatch) {
        if (array_key_exists('auto_priority_enabled', $in)) {
            $en = !empty($in['auto_priority_enabled']) ? 1 : 0;
            if ($en === 1) {
                $curA = $pdo->prepare('SELECT priority, COALESCE(auto_priority_enabled, 0) AS ape FROM tasks WHERE id = ?');
                $curA->execute([$id]);
                $crow = $curA->fetch(PDO::FETCH_ASSOC);
                if ($crow) {
                    $wasOff = (int) $crow['ape'] === 0;
                    $anchorPri = (string) $crow['priority'];
                    if (array_key_exists('priority', $in) && dt_is_allowed_priority((string) $in['priority'], $layoutPatch)) {
                        $anchorPri = (string) $in['priority'];
                    }
                    if ($wasOff) {
                        $updates[] = 'auto_priority_anchor_date = ?';
                        $params[] = date('Y-m-d');
                        $updates[] = 'auto_priority_anchor_priority = ?';
                        $params[] = $anchorPri;
                    }
                }
                $updates[] = 'auto_priority_enabled = 1';
            } else {
                $updates[] = 'auto_priority_enabled = 0';
                $updates[] = 'auto_priority_anchor_date = NULL';
                $updates[] = 'auto_priority_anchor_priority = NULL';
            }
        }
    }
    if ($hasAutoPriPatch && array_key_exists('priority', $in) && dt_is_allowed_priority((string) $in['priority'], $layoutPatch)) {
        $chk = $pdo->prepare('SELECT COALESCE(auto_priority_enabled, 0) FROM tasks WHERE id = ?');
        $chk->execute([$id]);
        if ((int) $chk->fetchColumn() === 1) {
            $updates[] = 'auto_priority_anchor_date = ?';
            $params[] = date('Y-m-d');
            $updates[] = 'auto_priority_anchor_priority = ?';
            $params[] = (string) $in['priority'];
        }
    }
    $hasOrgTables = $pdo->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_category'")->fetchColumn();
    $hasOrgUpdates = $hasOrgTables && (array_key_exists('category_id', $in) || array_key_exists('subcategory_id', $in) || (array_key_exists('tag_ids', $in) && is_array($in['tag_ids'])));
    if (empty($updates) && !$hasOrgUpdates) {
        logMessage('WARNING', 'tasks update no fields', ['id' => $id]);
        jsonError('No fields to update');
        exit;
    }
    if (!empty($updates)) {
        dt_append_updated_at($updates, $pdo, 'tasks');
        $params[] = $id;
        $sql = "UPDATE tasks SET " . implode(', ', $updates) . " WHERE id = ?";
        try {
            $pdo->prepare($sql)->execute($params);
        } catch (PDOException $e) {
            throw $e;
        }
    }
    $cols = 'id, title, priority, recurring, parent_id, created_at, list_state, list_style';
    $colStmt = $pdo->query("PRAGMA table_info(tasks)");
    $colNames = $colStmt ? array_column($colStmt->fetchAll(PDO::FETCH_ASSOC), 'name') : [];
    if (in_array('recurrence_rule', $colNames, true)) {
        $cols .= ', recurrence_rule';
    }
    if (in_array('due_date', $colNames, true)) {
        $cols .= ', due_date';
    }
    if (in_array('group_order', $colNames, true)) {
        $cols .= ', group_order';
    }
    if (in_array('is_common', $colNames, true)) {
        $cols .= ', is_common';
    }
    if (in_array('favorite_folder_id', $colNames, true)) {
        $cols .= ', favorite_folder_id';
    }
    if (in_array('auto_priority_enabled', $colNames, true)) {
        $cols .= ', auto_priority_enabled, auto_priority_mode, auto_priority_days_per_step, auto_priority_anchor_date, auto_priority_anchor_priority';
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

    $selfStmt = $pdo->prepare('SELECT parent_id, list_state FROM tasks WHERE id = ?');
    $selfStmt->execute([$id]);
    $selfRow = $selfStmt->fetch(PDO::FETCH_ASSOC);
    if (!$selfRow) {
        jsonResponse(['ok' => true]);
        exit;
    }

    $grandparentId = $selfRow['parent_id'] !== null && $selfRow['parent_id'] !== ''
        ? (int) $selfRow['parent_id']
        : null;
    $deletedListState = isset($selfRow['list_state']) ? (string) $selfRow['list_state'] : null;

    // Reparent direct children before delete so ON DELETE CASCADE does not remove siblings.
    $colStmt = $pdo->query('PRAGMA table_info(tasks)');
    $colNames = $colStmt ? array_column($colStmt->fetchAll(PDO::FETCH_ASSOC), 'name') : [];
    $hasGroupOrderDel = in_array('group_order', $colNames, true);

    $childOrderSql = $hasGroupOrderDel
        ? 'SELECT id FROM tasks WHERE parent_id = ? ORDER BY group_order ASC, id ASC'
        : 'SELECT id FROM tasks WHERE parent_id = ? ORDER BY id ASC';
    $childStmt = $pdo->prepare($childOrderSql);
    $childStmt->execute([$id]);
    $childIds = array_map('intval', $childStmt->fetchAll(PDO::FETCH_COLUMN));

    if (count($childIds) > 0) {
        $nextOrder = 0;
        if ($grandparentId !== null && $hasGroupOrderDel) {
            $nextOrderStmt = $pdo->prepare('SELECT COALESCE(MAX(group_order), -1) + 1 AS next_order FROM tasks WHERE parent_id = ?');
            $nextOrderStmt->execute([$grandparentId]);
            $nextOrder = (int) ($nextOrderStmt->fetchColumn() ?? 0);
        }
        foreach ($childIds as $childId) {
            if ($grandparentId === null) {
                if ($hasGroupOrderDel && $deletedListState !== null && $deletedListState !== '') {
                    $pdo->prepare('UPDATE tasks SET parent_id = NULL, group_order = 0, list_state = ? WHERE id = ?')
                        ->execute([$deletedListState, $childId]);
                } elseif ($hasGroupOrderDel) {
                    $pdo->prepare('UPDATE tasks SET parent_id = NULL, group_order = 0 WHERE id = ?')->execute([$childId]);
                } elseif ($deletedListState !== null && $deletedListState !== '') {
                    $pdo->prepare('UPDATE tasks SET parent_id = NULL, list_state = ? WHERE id = ?')
                        ->execute([$deletedListState, $childId]);
                } else {
                    $pdo->prepare('UPDATE tasks SET parent_id = NULL WHERE id = ?')->execute([$childId]);
                }
            } elseif ($hasGroupOrderDel) {
                $pdo->prepare('UPDATE tasks SET parent_id = ?, group_order = ? WHERE id = ?')
                    ->execute([$grandparentId, $nextOrder++, $childId]);
            } else {
                $pdo->prepare('UPDATE tasks SET parent_id = ? WHERE id = ?')->execute([$grandparentId, $childId]);
            }
        }
    }

    $pdo->prepare('DELETE FROM tasks WHERE id = ?')->execute([$id]);
    logMessage('INFO', 'tasks delete ok', ['id' => $id]);
    jsonResponse(['ok' => true]);
    exit;
}

logMessage('WARNING', 'tasks method not allowed', ['method' => $method]);
jsonError('Method not allowed', 405);
