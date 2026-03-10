<?php
/**
 * Organization API: CRUD for task_categories, task_subcategories, task_tags.
 * GET: list all. POST: create. PATCH: update. DELETE: delete.
 */
require_once __DIR__ . '/common.php';
require_once dirname(__DIR__) . '/lib/logger.php';

$pdo = getPdoSafe();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
logMessage('INFO', 'organization.php', ['method' => $method, 'user_id' => $userId]);

$hasTables = $pdo->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_categories'")->fetchColumn();
if (!$hasTables) {
    logMessage('INFO', 'organization tables not present');
    jsonResponse(['categories' => [], 'subcategories' => [], 'tags' => []]);
    exit;
}

if ($method === 'GET') {
    $categories = $pdo->query("SELECT id, name, color FROM task_categories ORDER BY name")->fetchAll(PDO::FETCH_ASSOC);
    $subcategories = $pdo->query("SELECT id, category_id, name FROM task_subcategories ORDER BY category_id, name")->fetchAll(PDO::FETCH_ASSOC);
    $tags = $pdo->query("SELECT id, name, color FROM task_tags ORDER BY name")->fetchAll(PDO::FETCH_ASSOC);
    jsonResponse(['categories' => $categories, 'subcategories' => $subcategories, 'tags' => $tags]);
    exit;
}

if ($method === 'POST') {
    $in = readJsonInput();
    if (!$in || !isset($in['type'])) {
        jsonError('type required (category, subcategory, tag)');
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
        $pdo->prepare("INSERT INTO task_categories (name, color) VALUES (?, ?)")->execute([$name, $color]);
        $id = (int) $pdo->lastInsertId();
        jsonResponse(['id' => $id, 'name' => $name, 'color' => $color]);
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
    jsonError('type must be category, subcategory, or tag');
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
    jsonError('type must be category, subcategory, or tag');
    exit;
}

if ($method === 'DELETE') {
    $type = $_GET['type'] ?? '';
    $id = isset($_GET['id']) ? (int) $_GET['id'] : 0;
    if ($id < 1 || !in_array($type, ['category', 'subcategory', 'tag'], true)) {
        jsonError('id and type (category, subcategory, tag) required');
        exit;
    }
    if ($type === 'category') {
        $pdo->prepare("DELETE FROM task_categories WHERE id = ?")->execute([$id]);
    } elseif ($type === 'subcategory') {
        $pdo->prepare("DELETE FROM task_subcategories WHERE id = ?")->execute([$id]);
    } else {
        $pdo->prepare("DELETE FROM task_tags WHERE id = ?")->execute([$id]);
    }
    jsonResponse(['ok' => true]);
    exit;
}

jsonError('Method not allowed', 405);
