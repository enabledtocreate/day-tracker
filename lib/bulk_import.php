<?php
/**
 * Bulk task import: validate rows and import atomically.
 */
declare(strict_types=1);

require_once __DIR__ . '/task_layout.php';

/**
 * @return array<string, mixed>
 */
function bi_parse_settings_json(?string $raw): array
{
    $default = [
        'add_new_values' => true,
        'ignore_case' => false,
    ];
    if ($raw === null || $raw === '') {
        return $default;
    }
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        return $default;
    }

    return [
        'add_new_values' => ($decoded['add_new_values'] ?? true) !== false,
        'ignore_case' => ($decoded['ignore_case'] ?? false) === true,
    ];
}

function bi_load_settings(PDO $pdo): array
{
    $stmt = $pdo->query("SELECT value FROM app_settings WHERE key = 'bulk_import_json' LIMIT 1");
    $raw = $stmt ? $stmt->fetchColumn() : false;

    return bi_parse_settings_json($raw !== false ? (string) $raw : null);
}

function bi_norm(string $s, bool $ignoreCase): string
{
    $t = trim($s);

    return $ignoreCase ? mb_strtolower($t) : $t;
}

/**
 * @param array<int, array<string, string>> $rows
 * @return array{ok:bool, errors: string[], cell_errors: array<int, array<string, string>>, grid_headers: string[], grid_rows: array<int, array<string, string>>}
 */
function bi_validate_rows(PDO $pdo, array $rows, array $biSettings, array $layoutRows): array
{
    $errors = [];
    $cellErrors = [];
    $ignoreCase = !empty($biSettings['ignore_case']);
    $addNew = !empty($biSettings['add_new_values']);
    $layout = dt_task_layout_from_settings_rows($layoutRows);

    $categories = [];
    $subcategories = [];
    $tags = [];
    $hasOrg = (bool) $pdo->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_categories'")->fetchColumn();
    if ($hasOrg) {
        foreach ($pdo->query('SELECT id, name, color FROM task_categories')->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $categories[] = $r;
        }
        foreach ($pdo->query('SELECT id, category_id, name FROM task_subcategories')->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $subcategories[] = $r;
        }
        foreach ($pdo->query('SELECT id, name, color FROM task_tags')->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $tags[] = $r;
        }
    }

    $bucketLabels = bi_bucket_label_map($layoutRows, $layout);
    $priorityMap = bi_priority_map($layoutRows, $layout);

    $gridHeaders = ['Task', 'Category', 'Subcategory', 'Tags', 'Priority', 'Due date', 'List', 'Recurring', 'List style', 'Links', 'Checklist'];
    $gridRows = [];

    if (count($rows) === 0) {
        return [
            'ok' => false,
            'errors' => ['No task rows found. Include a header row and at least one row with a Task title.'],
            'cell_errors' => [],
            'grid_headers' => $gridHeaders,
            'grid_rows' => [],
        ];
    }

    foreach ($rows as $idx => $row) {
        $line = $idx + 2;
        $gridRows[] = bi_row_to_grid($row);
        $title = trim((string) ($row['task'] ?? ''));
        if ($title === '') {
            $errors[] = "Row {$line}: Task is required.";
            $cellErrors[$idx]['task'] = 'Required';
            continue;
        }

        $catName = trim((string) ($row['category'] ?? ''));
        $subName = trim((string) ($row['subcategory'] ?? ''));
        if ($subName !== '' && $catName === '') {
            $errors[] = "Row {$line}: Subcategory requires Category.";
            $cellErrors[$idx]['subcategory'] = 'Requires Category';
        }

        if ($catName !== '' && !$addNew) {
            if (!bi_find_category($categories, $catName, $ignoreCase)) {
                $errors[] = "Row {$line}: Unknown category \"{$catName}\".";
                $cellErrors[$idx]['category'] = 'Unknown value';
            }
        }
        if ($subName !== '' && !$addNew && $catName !== '') {
            $cat = bi_find_category($categories, $catName, $ignoreCase);
            if ($cat && !bi_find_subcategory($subcategories, (int) $cat['id'], $subName, $ignoreCase)) {
                $errors[] = "Row {$line}: Unknown subcategory \"{$subName}\" for category \"{$catName}\".";
                $cellErrors[$idx]['subcategory'] = 'Unknown for category';
            }
        }

        $tagParts = bi_split_multi((string) ($row['tags'] ?? ''));
        foreach ($tagParts as $tg) {
            if ($tg === '') {
                continue;
            }
            if (!$addNew && !bi_find_tag($tags, $tg, $ignoreCase)) {
                $errors[] = "Row {$line}: Unknown tag \"{$tg}\".";
                $cellErrors[$idx]['tags'] = 'Unknown tag';
                break;
            }
        }

        $pri = trim((string) ($row['priority'] ?? ''));
        if ($pri !== '' && !bi_resolve_priority_slug($pri, $priorityMap, $ignoreCase)) {
            $errors[] = "Row {$line}: Unknown priority \"{$pri}\".";
            $cellErrors[$idx]['priority'] = 'Unknown value';
        }

        $listLabel = trim((string) ($row['list'] ?? ''));
        if ($listLabel !== '' && !bi_resolve_bucket_id($listLabel, $bucketLabels, $ignoreCase)) {
            $errors[] = "Row {$line}: Unknown list \"{$listLabel}\".";
            $cellErrors[$idx]['list'] = 'Unknown bucket label';
        }

        $due = trim((string) ($row['due_date'] ?? ''));
        if ($due !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $due)) {
            $errors[] = "Row {$line}: Due date must be YYYY-MM-DD.";
            $cellErrors[$idx]['due_date'] = 'Invalid date';
        }

        $rec = trim((string) ($row['recurring'] ?? ''));
        if ($rec !== '' && !bi_parse_bool($rec)) {
            $errors[] = "Row {$line}: Recurring must be yes/no.";
            $cellErrors[$idx]['recurring'] = 'Invalid';
        }

        $ls = trim((string) ($row['list_style'] ?? ''));
        if ($ls !== '' && !in_array(bi_norm($ls, true), ['bullet', 'checklist'], true)) {
            $errors[] = "Row {$line}: List style must be bullet or checklist.";
            $cellErrors[$idx]['list_style'] = 'Invalid';
        }
    }

    return [
        'ok' => count($errors) === 0,
        'errors' => $errors,
        'cell_errors' => $cellErrors,
        'grid_headers' => $gridHeaders,
        'grid_rows' => $gridRows,
    ];
}

/**
 * @param array<int, array<string, string>> $rows
 */
function bi_import_rows(PDO $pdo, array $rows, array $biSettings, array $layoutRows): int
{
    $ignoreCase = !empty($biSettings['ignore_case']);
    $addNew = !empty($biSettings['add_new_values']);
    $layout = dt_task_layout_from_settings_rows($layoutRows);
    $defaultBucket = $layout['bucket_ids'][0] ?? 'unassigned';
    $fallbackPri = in_array('low', $layout['priority_ids'], true)
        ? 'low'
        : ($layout['priority_ids'][count($layout['priority_ids']) - 1] ?? 'medium');

    $pdo->beginTransaction();
    try {
        $categories = [];
        $subcategories = [];
        $tags = [];
        $hasOrg = (bool) $pdo->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_categories'")->fetchColumn();
        if ($hasOrg) {
            foreach ($pdo->query('SELECT id, name, color FROM task_categories')->fetchAll(PDO::FETCH_ASSOC) as $r) {
                $categories[(int) $r['id']] = $r;
            }
            foreach ($pdo->query('SELECT id, category_id, name FROM task_subcategories')->fetchAll(PDO::FETCH_ASSOC) as $r) {
                $subcategories[] = $r;
            }
            foreach ($pdo->query('SELECT id, name, color FROM task_tags')->fetchAll(PDO::FETCH_ASSOC) as $r) {
                $tags[(int) $r['id']] = $r;
            }
        }

        $bucketLabels = bi_bucket_label_map($layoutRows, $layout);
        $priorityMap = bi_priority_map($layoutRows, $layout);

        $colStmt = $pdo->query('PRAGMA table_info(tasks)');
        $colNames = $colStmt ? array_column($colStmt->fetchAll(PDO::FETCH_ASSOC), 'name') : [];
        $hasDue = in_array('due_date', $colNames, true);

        $count = 0;
        foreach ($rows as $row) {
            $title = trim((string) ($row['task'] ?? ''));
            if ($title === '') {
                continue;
            }
            $priSlug = $fallbackPri;
            $priIn = trim((string) ($row['priority'] ?? ''));
            if ($priIn !== '') {
                $resolved = bi_resolve_priority_slug($priIn, $priorityMap, $ignoreCase);
                if ($resolved) {
                    $priSlug = $resolved;
                }
            }
            $listState = $defaultBucket;
            $listIn = trim((string) ($row['list'] ?? ''));
            if ($listIn !== '') {
                $bid = bi_resolve_bucket_id($listIn, $bucketLabels, $ignoreCase);
                if ($bid) {
                    $listState = $bid;
                }
            }
            $recurring = bi_parse_bool((string) ($row['recurring'] ?? '')) === true ? 1 : 0;
            $checkItems = bi_split_multi((string) ($row['checklist'] ?? ''));
            $listStyle = count($checkItems) > 0 ? 'checklist' : 'bullet';
            $lsIn = trim((string) ($row['list_style'] ?? ''));
            if ($lsIn !== '') {
                $n = bi_norm($lsIn, true);
                $listStyle = $n === 'checklist' ? 'checklist' : 'bullet';
            }

            $ins = $pdo->prepare('INSERT INTO tasks (title, priority, recurring, parent_id, list_style, list_state) VALUES (?, ?, ?, NULL, ?, ?)');
            $ins->execute([$title, $priSlug, $recurring, $listStyle, $listState]);
            $taskId = (int) $pdo->lastInsertId();

            if ($hasDue) {
                $due = trim((string) ($row['due_date'] ?? ''));
                if ($due !== '' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $due)) {
                    $pdo->prepare('UPDATE tasks SET due_date = ? WHERE id = ?')->execute([$due, $taskId]);
                }
            }
            if ($recurring === 1 && in_array('recurrence_rule', $colNames, true)) {
                $pdo->prepare('UPDATE tasks SET recurrence_rule = ? WHERE id = ?')->execute(['{"freq":"daily","time":"09:00"}', $taskId]);
            }

            if ($hasOrg) {
                $catId = bi_ensure_category($pdo, $categories, $subcategories, $row, $addNew, $ignoreCase);
                if ($catId) {
                    $pdo->prepare('INSERT OR REPLACE INTO task_category (task_id, category_id) VALUES (?, ?)')->execute([$taskId, $catId]);
                    $subId = bi_ensure_subcategory($pdo, $subcategories, $catId, $row, $addNew, $ignoreCase);
                    if ($subId) {
                        $pdo->prepare('INSERT OR REPLACE INTO task_subcategory (task_id, subcategory_id) VALUES (?, ?)')->execute([$taskId, $subId]);
                    }
                }
                $tagParts = bi_split_multi((string) ($row['tags'] ?? ''));
                $colorParts = bi_split_multi((string) ($row['tag_colors'] ?? ''));
                $pdo->prepare('DELETE FROM task_tag WHERE task_id = ?')->execute([$taskId]);
                $tagIns = $pdo->prepare('INSERT INTO task_tag (task_id, tag_id) VALUES (?, ?)');
                foreach ($tagParts as $i => $tgName) {
                    if ($tgName === '') {
                        continue;
                    }
                    $color = isset($colorParts[$i]) ? trim($colorParts[$i]) : '';
                    $tid = bi_ensure_tag($pdo, $tags, $tgName, $color, $addNew, $ignoreCase);
                    if ($tid) {
                        $tagIns->execute([$taskId, $tid]);
                    }
                }
            }

            foreach (bi_split_links((string) ($row['links'] ?? '')) as $link) {
                if ($link['url'] === '') {
                    continue;
                }
                $pdo->prepare('INSERT INTO task_links (task_id, url, description) VALUES (?, ?, ?)')->execute([
                    $taskId,
                    $link['url'],
                    $link['description'],
                ]);
            }
            foreach ($checkItems as $i => $content) {
                if ($content === '') {
                    continue;
                }
                $pdo->prepare('INSERT INTO task_list_items (task_id, content, order_index, completed) VALUES (?, ?, ?, 0)')->execute([
                    $taskId,
                    $content,
                    $i,
                ]);
            }
            $count++;
        }
        $pdo->commit();

        return $count;
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}

function bi_split_multi(string $value): array
{
    if (trim($value) === '') {
        return [];
    }
    $parts = explode(',', $value);
    $out = [];
    foreach ($parts as $p) {
        $t = trim($p);
        if ($t !== '') {
            $out[] = $t;
        }
    }

    return $out;
}

/**
 * @return array<int, array{url: string, description: string}>
 */
function bi_split_links(string $value): array
{
    $out = [];
    foreach (bi_split_multi($value) as $part) {
        $pipe = strpos($part, '|');
        if ($pipe !== false) {
            $out[] = ['url' => trim(substr($part, 0, $pipe)), 'description' => trim(substr($part, $pipe + 1))];
        } else {
            $out[] = ['url' => $part, 'description' => ''];
        }
    }

    return $out;
}

function bi_parse_bool(string $value): ?bool
{
    $v = bi_norm($value, true);
    if ($v === '') {
        return null;
    }
    if (in_array($v, ['1', 'true', 'yes', 'y'], true)) {
        return true;
    }
    if (in_array($v, ['0', 'false', 'no', 'n'], true)) {
        return false;
    }

    return null;
}

/**
 * @param array<string, string> $layoutRows
 * @return array<string, string> norm label -> bucket id
 */
function bi_bucket_label_map(array $layoutRows, array $layout): array
{
    $map = [];
    $rawBl = $layoutRows['bucket_layout_json'] ?? '';
    if ($rawBl !== '') {
        $decoded = json_decode($rawBl, true);
        if (is_array($decoded) && isset($decoded['buckets']) && is_array($decoded['buckets'])) {
            foreach ($decoded['buckets'] as $b) {
                if (!is_array($b)) {
                    continue;
                }
                $id = isset($b['id']) ? trim((string) $b['id']) : '';
                $label = isset($b['label']) ? trim((string) $b['label']) : '';
                if ($id !== '' && $label !== '') {
                    $map[mb_strtolower($label)] = $id;
                    $map[$id] = $id;
                }
            }

            return $map;
        }
    }
    $raw = $layoutRows['bucket_labels_json'] ?? '';
    $u = 'Unassigned';
    $p = 'Pending';
    if ($raw !== '') {
        $d = json_decode($raw, true);
        if (is_array($d)) {
            $u = trim((string) ($d['unassigned'] ?? $u)) ?: $u;
            $p = trim((string) ($d['pending'] ?? $p)) ?: $p;
        }
    }
    $map[mb_strtolower($u)] = 'unassigned';
    $map[mb_strtolower($p)] = 'pending';
    $map['unassigned'] = 'unassigned';
    $map['pending'] = 'pending';

    return $map;
}

function bi_resolve_bucket_id(string $label, array $map, bool $ignoreCase): ?string
{
    $k = $ignoreCase ? mb_strtolower(trim($label)) : trim($label);

    return $map[$k] ?? null;
}

/**
 * @return array<string, array{slug: string, labels: string[]}>
 */
function bi_priority_map(array $layoutRows, array $layout): array
{
    $map = [];
    $rawPl = $layoutRows['priority_layout_json'] ?? '';
    if ($rawPl !== '') {
        $decoded = json_decode($rawPl, true);
        if (is_array($decoded) && isset($decoded['priorities']) && is_array($decoded['priorities'])) {
            foreach ($decoded['priorities'] as $pr) {
                if (!is_array($pr)) {
                    continue;
                }
                $slug = isset($pr['id']) ? trim((string) $pr['id']) : '';
                $label = isset($pr['label']) ? trim((string) $pr['label']) : '';
                if ($slug === '') {
                    continue;
                }
                $labels = [$slug];
                if ($label !== '') {
                    $labels[] = $label;
                }
                $map[$slug] = ['slug' => $slug, 'labels' => $labels];
            }

            return $map;
        }
    }
    $defaults = ['commitment' => 'Commitment', 'high' => 'High', 'medium' => 'Medium', 'low' => 'Low'];
    foreach ($defaults as $slug => $label) {
        $map[$slug] = ['slug' => $slug, 'labels' => [$slug, $label]];
    }

    return $map;
}

function bi_resolve_priority_slug(string $input, array $priorityMap, bool $ignoreCase): ?string
{
    $needle = bi_norm($input, $ignoreCase);
    foreach ($priorityMap as $slug => $meta) {
        foreach ($meta['labels'] as $lab) {
            if (bi_norm($lab, $ignoreCase) === $needle) {
                return $slug;
            }
        }
    }

    return null;
}

/**
 * @param array<int, array<string, mixed>> $categories
 */
function bi_find_category(array $categories, string $name, bool $ignoreCase): ?array
{
    $needle = bi_norm($name, $ignoreCase);
    foreach ($categories as $c) {
        if (bi_norm((string) $c['name'], $ignoreCase) === $needle) {
            return $c;
        }
    }

    return null;
}

/**
 * @param array<int, array<string, mixed>> $subcategories
 */
function bi_find_subcategory(array $subcategories, int $categoryId, string $name, bool $ignoreCase): ?array
{
    $needle = bi_norm($name, $ignoreCase);
    foreach ($subcategories as $s) {
        if ((int) $s['category_id'] === $categoryId && bi_norm((string) $s['name'], $ignoreCase) === $needle) {
            return $s;
        }
    }

    return null;
}

/**
 * @param array<int, array<string, mixed>> $tags
 */
function bi_find_tag(array $tags, string $name, bool $ignoreCase): ?array
{
    $needle = bi_norm($name, $ignoreCase);
    foreach ($tags as $t) {
        if (bi_norm((string) $t['name'], $ignoreCase) === $needle) {
            return $t;
        }
    }

    return null;
}

/**
 * @param array<int, array<string, mixed>> $categories
 * @param array<int, array<string, mixed>> $subcategories
 * @param array<string, string> $row
 */
function bi_ensure_category(PDO $pdo, array &$categories, array &$subcategories, array $row, bool $addNew, bool $ignoreCase): ?int
{
    $name = trim((string) ($row['category'] ?? ''));
    if ($name === '') {
        return null;
    }
    $found = bi_find_category(array_values($categories), $name, $ignoreCase);
    if ($found) {
        return (int) $found['id'];
    }
    if (!$addNew) {
        return null;
    }
    $color = trim((string) ($row['category_color'] ?? ''));
    if ($color === '') {
        $hue = rand(0, 359);
        $color = 'hsl(' . $hue . ',65%,50%)';
    }
    $pdo->prepare('INSERT INTO task_categories (name, color, icon) VALUES (?, ?, NULL)')->execute([$name, $color]);
    $id = (int) $pdo->lastInsertId();
    $categories[$id] = ['id' => $id, 'name' => $name, 'color' => $color];
    $subcategories = array_merge($subcategories, []);

    return $id;
}

/**
 * @param array<int, array<string, mixed>> $subcategories
 * @param array<string, string> $row
 */
function bi_ensure_subcategory(PDO $pdo, array &$subcategories, int $categoryId, array $row, bool $addNew, bool $ignoreCase): ?int
{
    $name = trim((string) ($row['subcategory'] ?? ''));
    if ($name === '') {
        return null;
    }
    $found = bi_find_subcategory($subcategories, $categoryId, $name, $ignoreCase);
    if ($found) {
        return (int) $found['id'];
    }
    if (!$addNew) {
        return null;
    }
    $pdo->prepare('INSERT INTO task_subcategories (category_id, name) VALUES (?, ?)')->execute([$categoryId, $name]);
    $id = (int) $pdo->lastInsertId();
    $subcategories[] = ['id' => $id, 'category_id' => $categoryId, 'name' => $name];

    return $id;
}

/**
 * @param array<int, array<string, mixed>> $tags
 */
function bi_ensure_tag(PDO $pdo, array &$tags, string $name, string $color, bool $addNew, bool $ignoreCase): ?int
{
    $found = bi_find_tag(array_values($tags), $name, $ignoreCase);
    if ($found) {
        return (int) $found['id'];
    }
    if (!$addNew) {
        return null;
    }
    if ($color === '') {
        $hue = rand(0, 359);
        $color = 'hsl(' . $hue . ',65%,50%)';
    }
    $pdo->prepare('INSERT INTO task_tags (name, color) VALUES (?, ?)')->execute([$name, $color]);
    $id = (int) $pdo->lastInsertId();
    $tags[$id] = ['id' => $id, 'name' => $name, 'color' => $color];

    return $id;
}

/**
 * @param array<string, string> $row
 * @return array<string, string>
 */
function bi_row_to_grid(array $row): array
{
    return [
        'Task' => (string) ($row['task'] ?? ''),
        'Category' => (string) ($row['category'] ?? ''),
        'Subcategory' => (string) ($row['subcategory'] ?? ''),
        'Tags' => (string) ($row['tags'] ?? ''),
        'Priority' => (string) ($row['priority'] ?? ''),
        'Due date' => (string) ($row['due_date'] ?? ''),
        'List' => (string) ($row['list'] ?? ''),
        'Recurring' => (string) ($row['recurring'] ?? ''),
        'List style' => (string) ($row['list_style'] ?? ''),
        'Links' => (string) ($row['links'] ?? ''),
        'Checklist' => (string) ($row['checklist'] ?? ''),
    ];
}
