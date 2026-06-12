<?php
/**
 * Organization API: CRUD for task_categories, task_subcategories, task_tags, task_blocks.
 * GET: list all. POST: create. PATCH: update. DELETE: delete.
 */
require_once __DIR__ . '/common.php';
require_once dirname(__DIR__) . '/lib/logger.php';

$pdo = getPdoSafe();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
logMessage('INFO', 'organization.php', ['method' => $method, 'user_id' => $userId]);

$ORG_ICON_LIST = require __DIR__ . '/org_icon_whitelist.php';
if (!is_array($ORG_ICON_LIST)) {
    $ORG_ICON_LIST = [];
}
$ORG_ICON_FLIP = array_fill_keys($ORG_ICON_LIST, true);

/**
 * Legacy PascalCase names (e.g. BookOpen) → kebab-case (book-open) for whitelist lookup.
 */
function org_icon_legacy_pascal_to_kebab(string $s): string
{
    $x = preg_replace('/([a-zA-Z])(\d)/', '$1-$2', $s);
    $x = preg_replace('/([a-z0-9])([A-Z])/', '$1-$2', $x);
    $x = preg_replace('/([A-Z])([A-Z][a-z])/', '$1-$2', $x);
    return strtolower($x);
}

/**
 * @param mixed $raw
 * @param array<string, true> $flip whitelist keys = kebab-case icon names from lucide-react
 */
function org_sanitize_lucide_icon($raw, array $flip): ?string
{
    if ($raw === null || $raw === '') {
        return null;
    }
    $s = trim((string) $raw);
    if ($s === '' || strlen($s) > 72) {
        return null;
    }
    $lower = strtolower($s);
    if (isset($flip[$lower])) {
        return $lower;
    }
    if (str_contains($s, '-') || !preg_match('/[A-Z]/', $s)) {
        return null;
    }
    $leg = org_icon_legacy_pascal_to_kebab($s);
    return isset($flip[$leg]) ? $leg : null;
}

$hasTables = $pdo->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_categories'")->fetchColumn();
if (!$hasTables) {
    logMessage('INFO', 'organization tables not present');
    jsonResponse(['categories' => [], 'subcategories' => [], 'tags' => [], 'blocks' => []]);
    exit;
}
$pdo->exec("CREATE TABLE IF NOT EXISTS task_blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT,
    icon TEXT
)");

if ($method === 'GET') {
    $categories = $pdo->query("SELECT id, name, color, icon FROM task_categories ORDER BY name")->fetchAll(PDO::FETCH_ASSOC);
    $subcategories = $pdo->query("SELECT id, category_id, name FROM task_subcategories ORDER BY category_id, name")->fetchAll(PDO::FETCH_ASSOC);
    $tags = $pdo->query("SELECT id, name, color FROM task_tags ORDER BY name")->fetchAll(PDO::FETCH_ASSOC);
    $blocks = $pdo->query("SELECT id, name, color, icon FROM task_blocks ORDER BY name")->fetchAll(PDO::FETCH_ASSOC);
    jsonResponse(['categories' => $categories, 'subcategories' => $subcategories, 'tags' => $tags, 'blocks' => $blocks]);
    exit;
}

if ($method === 'POST') {
    $in = readJsonInput();
    if (!$in || !isset($in['type'])) {
        jsonError('type required (category, subcategory, tag, block)');
        exit;
    }
    $type = $in['type'];
    if ($type === 'category') {
        $name = isset($in['name']) ? trim($in['name']) : '';
        if ($name === '') {
            jsonError('name required');
            exit;
        }
        $color = isset($in['color']) ? trim($in['color']) : null;
        $icon = array_key_exists('icon', $in) ? org_sanitize_lucide_icon($in['icon'], $ORG_ICON_FLIP) : null;
        $pdo->prepare("INSERT INTO task_categories (name, color, icon) VALUES (?, ?, ?)")->execute([$name, $color, $icon]);
        $id = (int) $pdo->lastInsertId();
        jsonResponse(['id' => $id, 'name' => $name, 'color' => $color, 'icon' => $icon]);
        exit;
    }
    if ($type === 'subcategory') {
        $categoryId = isset($in['category_id']) ? (int) $in['category_id'] : 0;
        $name = isset($in['name']) ? trim($in['name']) : '';
        if ($categoryId < 1 || $name === '') {
            jsonError('category_id and name required');
            exit;
        }
        $pdo->prepare("INSERT INTO task_subcategories (category_id, name) VALUES (?, ?)")->execute([$categoryId, $name]);
        $id = (int) $pdo->lastInsertId();
        jsonResponse(['id' => $id, 'category_id' => $categoryId, 'name' => $name]);
        exit;
    }
    if ($type === 'tag') {
        $name = isset($in['name']) ? trim($in['name']) : '';
        if ($name === '') {
            jsonError('name required');
            exit;
        }
        $color = isset($in['color']) && trim($in['color']) !== '' ? trim($in['color']) : null;
        if ($color === null) {
            $hue = rand(0, 359);
            $color = 'hsl(' . $hue . ',65%,50%)';
        }
        $pdo->prepare("INSERT INTO task_tags (name, color) VALUES (?, ?)")->execute([$name, $color]);
        $id = (int) $pdo->lastInsertId();
        jsonResponse(['id' => $id, 'name' => $name, 'color' => $color]);
        exit;
    }
    if ($type === 'block') {
        $name = isset($in['name']) ? trim($in['name']) : '';
        if ($name === '') {
            jsonError('name required');
            exit;
        }
        $color = isset($in['color']) && trim($in['color']) !== '' ? trim($in['color']) : null;
        if ($color === null) {
            $hue = rand(0, 359);
            $color = 'hsl(' . $hue . ',65%,50%)';
        }
        $icon = array_key_exists('icon', $in) ? org_sanitize_lucide_icon($in['icon'], $ORG_ICON_FLIP) : null;
        $pdo->prepare("INSERT INTO task_blocks (name, color, icon) VALUES (?, ?, ?)")->execute([$name, $color, $icon]);
        $id = (int) $pdo->lastInsertId();
        jsonResponse(['id' => $id, 'name' => $name, 'color' => $color, 'icon' => $icon]);
        exit;
    }
    jsonError('type must be category, subcategory, tag, or block');
    exit;
}

if ($method === 'PATCH') {
    $in = readJsonInput();
    if (!$in || !isset($in['type']) || empty($in['id'])) {
        jsonError('type and id required');
        exit;
    }
    $type = $in['type'];
    $id = (int) $in['id'];
    if ($type === 'category') {
        $updates = [];
        $params = [];
        if (array_key_exists('name', $in)) {
            $updates[] = 'name = ?';
            $params[] = trim($in['name']);
        }
        if (array_key_exists('color', $in)) {
            $updates[] = 'color = ?';
            $params[] = trim($in['color']) !== '' ? trim($in['color']) : null;
        }
        if (array_key_exists('icon', $in)) {
            $updates[] = 'icon = ?';
            $rawI = $in['icon'];
            if ($rawI === null || $rawI === '') {
                $params[] = null;
            } else {
                $params[] = org_sanitize_lucide_icon($rawI, $ORG_ICON_FLIP);
            }
        }
        if (empty($updates)) {
            jsonError('No fields to update');
            exit;
        }
        $params[] = $id;
        $pdo->prepare("UPDATE task_categories SET " . implode(', ', $updates) . " WHERE id = ?")->execute($params);
        jsonResponse(['ok' => true]);
        exit;
    }
    if ($type === 'subcategory') {
        $updates = [];
        $params = [];
        if (array_key_exists('name', $in)) {
            $updates[] = 'name = ?';
            $params[] = trim($in['name']);
        }
        if (array_key_exists('category_id', $in)) {
            $updates[] = 'category_id = ?';
            $params[] = (int) $in['category_id'];
        }
        if (empty($updates)) {
            jsonError('No fields to update');
            exit;
        }
        $params[] = $id;
        $pdo->prepare("UPDATE task_subcategories SET " . implode(', ', $updates) . " WHERE id = ?")->execute($params);
        jsonResponse(['ok' => true]);
        exit;
    }
    if ($type === 'tag') {
        $updates = [];
        $params = [];
        if (array_key_exists('name', $in)) {
            $updates[] = 'name = ?';
            $params[] = trim($in['name']);
        }
        if (array_key_exists('color', $in)) {
            $updates[] = 'color = ?';
            $params[] = trim($in['color']) !== '' ? trim($in['color']) : null;
        }
        if (empty($updates)) {
            jsonError('No fields to update');
            exit;
        }
        $params[] = $id;
        $pdo->prepare("UPDATE task_tags SET " . implode(', ', $updates) . " WHERE id = ?")->execute($params);
        jsonResponse(['ok' => true]);
        exit;
    }
    if ($type === 'block') {
        $updates = [];
        $params = [];
        if (array_key_exists('name', $in)) {
            $updates[] = 'name = ?';
            $params[] = trim($in['name']);
        }
        if (array_key_exists('color', $in)) {
            $updates[] = 'color = ?';
            $params[] = trim($in['color']) !== '' ? trim($in['color']) : null;
        }
        if (array_key_exists('icon', $in)) {
            $updates[] = 'icon = ?';
            $rawI = $in['icon'];
            if ($rawI === null || $rawI === '') {
                $params[] = null;
            } else {
                $params[] = org_sanitize_lucide_icon($rawI, $ORG_ICON_FLIP);
            }
        }
        if (empty($updates)) {
            jsonError('No fields to update');
            exit;
        }
        $params[] = $id;
        $pdo->prepare("UPDATE task_blocks SET " . implode(', ', $updates) . " WHERE id = ?")->execute($params);
        jsonResponse(['ok' => true]);
        exit;
    }
    jsonError('type must be category, subcategory, tag, or block');
    exit;
}

if ($method === 'DELETE') {
    $type = $_GET['type'] ?? '';
    $id = isset($_GET['id']) ? (int) $_GET['id'] : 0;
    if ($id < 1 || !in_array($type, ['category', 'subcategory', 'tag', 'block'], true)) {
        jsonError('id and type (category, subcategory, tag, block) required');
        exit;
    }
    if ($type === 'category') {
        $pdo->prepare("DELETE FROM task_categories WHERE id = ?")->execute([$id]);
    } elseif ($type === 'subcategory') {
        $pdo->prepare("DELETE FROM task_subcategories WHERE id = ?")->execute([$id]);
    } elseif ($type === 'tag') {
        $pdo->prepare("DELETE FROM task_tags WHERE id = ?")->execute([$id]);
    } else {
        $pdo->prepare("DELETE FROM task_blocks WHERE id = ?")->execute([$id]);
    }
    jsonResponse(['ok' => true]);
    exit;
}

jsonError('Method not allowed', 405);
