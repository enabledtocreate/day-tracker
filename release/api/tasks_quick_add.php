<?php
/**
 * Quick add: create tasks from line-delimited titles with shared task details.
 * POST { titles: string[], list_state?, priority?, due_date?, category_id?, subcategory_id?,
 *         tag_ids?, auto_priority_enabled?, auto_complete_eod?, default_block_id?, default_duration_intervals? }
 */
require_once __DIR__ . '/common.php';
require_once dirname(__DIR__) . '/lib/logger.php';
require_once dirname(__DIR__) . '/lib/bulk_import.php';
require_once dirname(__DIR__) . '/lib/task_layout.php';

$pdo = getPdoSafe();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'POST') {
    jsonError('Method not allowed', 405);
    exit;
}

$in = readJsonInput();
if (!$in || !is_array($in)) {
    jsonError('JSON body required');
    exit;
}
$titlesIn = $in['titles'] ?? null;
if (!is_array($titlesIn)) {
    jsonError('titles array required');
    exit;
}

$biSettings = bi_load_settings($pdo);
$allowDup = true;
$stmt = $pdo->query("SELECT value FROM app_settings WHERE key = 'bulk_import_json' LIMIT 1");
$raw = $stmt ? $stmt->fetchColumn() : false;
if ($raw !== false) {
    $decoded = json_decode((string) $raw, true);
    if (is_array($decoded) && array_key_exists('allow_duplicates_quick_add', $decoded)) {
        $allowDup = $decoded['allow_duplicates_quick_add'] !== false;
    }
}

$layout = dt_task_layout_from_pdo($pdo);
$defaultBucket = $layout['bucket_ids'][0] ?? 'unassigned';
$bucket = isset($in['list_state']) && in_array((string) $in['list_state'], $layout['bucket_ids'], true)
    ? (string) $in['list_state']
    : $defaultBucket;
$fallbackPri = in_array('low', $layout['priority_ids'], true)
    ? 'low'
    : ($layout['priority_ids'][count($layout['priority_ids']) - 1] ?? 'medium');
$priority = isset($in['priority']) && dt_is_allowed_priority((string) $in['priority'], $layout)
    ? (string) $in['priority']
    : $fallbackPri;

$dueDate = null;
if (array_key_exists('due_date', $in)) {
    $rawDue = $in['due_date'];
    if ($rawDue !== null && $rawDue !== '') {
        $s = trim((string) $rawDue);
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $s)) {
            jsonError('due_date must be YYYY-MM-DD or null', 400);
            exit;
        }
        $dueDate = $s;
    }
}

$colStmt = $pdo->query('PRAGMA table_info(tasks)');
$colNames = $colStmt ? array_column($colStmt->fetchAll(PDO::FETCH_ASSOC), 'name') : [];
$hasDueDate = in_array('due_date', $colNames, true);
$hasAutoCompleteEod = in_array('auto_complete_eod', $colNames, true);
$hasAutoPri = in_array('auto_priority_enabled', $colNames, true);
$hasDefaultBlock = in_array('default_block_id', $colNames, true);

$autoCompleteEod = !empty($in['auto_complete_eod']) ? 1 : 0;
$autoPriorityEnabled = !empty($in['auto_priority_enabled']) ? 1 : 0;

$defaultBlockId = null;
if ($hasDefaultBlock && array_key_exists('default_block_id', $in)) {
    $rawBlock = $in['default_block_id'];
    if ($rawBlock !== null && $rawBlock !== '' && $rawBlock !== false) {
        $bid = (int) $rawBlock;
        if ($bid > 0) {
            $bok = $pdo->prepare('SELECT 1 FROM task_blocks WHERE id = ?');
            $bok->execute([$bid]);
            if ($bok->fetchColumn()) {
                $defaultBlockId = $bid;
            }
        }
    }
}
$defaultDurationIntervals = max(1, (int) ($in['default_duration_intervals'] ?? 1));

$categoryId = null;
$subcategoryId = null;
$hasOrg = (bool) $pdo->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_category'")->fetchColumn();
if ($hasOrg) {
    if (array_key_exists('category_id', $in) && $in['category_id'] !== null && $in['category_id'] !== '') {
        $cid = (int) $in['category_id'];
        if ($cid > 0) {
            $cok = $pdo->prepare('SELECT 1 FROM task_categories WHERE id = ?');
            $cok->execute([$cid]);
            if ($cok->fetchColumn()) {
                $categoryId = $cid;
            }
        }
    }
    if (array_key_exists('subcategory_id', $in) && $in['subcategory_id'] !== null && $in['subcategory_id'] !== '') {
        $sid = (int) $in['subcategory_id'];
        if ($sid > 0) {
            $sok = $pdo->prepare('SELECT 1 FROM task_subcategories WHERE id = ?');
            $sok->execute([$sid]);
            if ($sok->fetchColumn()) {
                $subcategoryId = $sid;
            }
        }
    }
}

$tagIds = [];
if ($hasOrg && isset($in['tag_ids']) && is_array($in['tag_ids'])) {
    foreach ($in['tag_ids'] as $tid) {
        $tid = (int) $tid;
        if ($tid > 0) {
            $tok = $pdo->prepare('SELECT 1 FROM task_tags WHERE id = ?');
            $tok->execute([$tid]);
            if ($tok->fetchColumn()) {
                $tagIds[] = $tid;
            }
        }
    }
}

$titles = [];
foreach ($titlesIn as $t) {
    $s = trim(is_string($t) ? $t : (string) $t);
    if ($s !== '') {
        $titles[] = $s;
    }
}
if (count($titles) === 0) {
    jsonError('No task titles provided');
    exit;
}

$existing = [];
if (!$allowDup) {
    $st = $pdo->prepare('SELECT title FROM tasks WHERE list_state = ? AND (is_common IS NULL OR is_common = 0)');
    $st->execute([$bucket]);
    while ($row = $st->fetch(PDO::FETCH_ASSOC)) {
        $existing[trim((string) $row['title'])] = true;
    }
}

$pdo->beginTransaction();
try {
    $created = 0;
    $ins = $pdo->prepare('INSERT INTO tasks (title, priority, recurring, parent_id, list_style, list_state) VALUES (?, ?, 0, NULL, ?, ?)');
    foreach ($titles as $title) {
        if (!$allowDup && isset($existing[$title])) {
            continue;
        }
        $ins->execute([$title, $priority, 'bullet', $bucket]);
        $newId = (int) $pdo->lastInsertId();

        if ($hasDueDate && $dueDate !== null) {
            $pdo->prepare('UPDATE tasks SET due_date = ? WHERE id = ?')->execute([$dueDate, $newId]);
        }
        if ($hasAutoCompleteEod && $autoCompleteEod === 1) {
            $pdo->prepare('UPDATE tasks SET auto_complete_eod = 1 WHERE id = ?')->execute([$newId]);
        }
        if ($hasAutoPri && $autoPriorityEnabled === 1) {
            $pdo->prepare(
                'UPDATE tasks SET auto_priority_enabled = 1, auto_priority_anchor_date = ?, auto_priority_anchor_priority = ? WHERE id = ?'
            )->execute([date('Y-m-d'), $priority, $newId]);
        }
        if ($hasDefaultBlock && $defaultBlockId !== null) {
            $pdo->prepare('UPDATE tasks SET default_block_id = ?, default_duration_intervals = ? WHERE id = ?')->execute([
                $defaultBlockId,
                $defaultDurationIntervals,
                $newId,
            ]);
        } elseif ($hasDefaultBlock && array_key_exists('default_duration_intervals', $in)) {
            $pdo->prepare('UPDATE tasks SET default_duration_intervals = ? WHERE id = ?')->execute([
                $defaultDurationIntervals,
                $newId,
            ]);
        }
        if ($hasOrg) {
            if ($categoryId !== null) {
                $pdo->prepare('INSERT OR REPLACE INTO task_category (task_id, category_id) VALUES (?, ?)')->execute([$newId, $categoryId]);
            }
            if ($subcategoryId !== null) {
                $pdo->prepare('INSERT OR REPLACE INTO task_subcategory (task_id, subcategory_id) VALUES (?, ?)')->execute([$newId, $subcategoryId]);
            }
            if (count($tagIds) > 0) {
                $tIns = $pdo->prepare('INSERT INTO task_tag (task_id, tag_id) VALUES (?, ?)');
                foreach ($tagIds as $tid) {
                    $tIns->execute([$newId, $tid]);
                }
            }
        }

        $existing[$title] = true;
        $created++;
    }
    $pdo->commit();
    jsonResponse(['ok' => true, 'created' => $created]);
} catch (Throwable $e) {
    $pdo->rollBack();
    logMessage('ERROR', 'tasks_quick_add failed', ['message' => $e->getMessage()]);
    jsonError('Quick add failed: ' . $e->getMessage(), 500);
}
