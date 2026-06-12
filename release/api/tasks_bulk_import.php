<?php
/**
 * Bulk task import from parsed rows (client parses CSV/TSV with Papa Parse).
 * POST { rows: array<record<string,string>>, validate_only?: bool }
 */
require_once __DIR__ . '/common.php';
require_once dirname(__DIR__) . '/lib/logger.php';
require_once dirname(__DIR__) . '/lib/bulk_import.php';

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
$rawRows = $in['rows'] ?? null;
if (!is_array($rawRows)) {
    jsonError('rows array required');
    exit;
}

$rows = [];
foreach ($rawRows as $r) {
    if (!is_array($r)) {
        continue;
    }
    $norm = [];
    foreach ($r as $k => $v) {
        $key = is_string($k) ? trim($k) : '';
        if ($key === '') {
            continue;
        }
        $norm[$key] = is_string($v) ? trim($v) : trim((string) $v);
    }
    if (isset($norm['task']) && $norm['task'] !== '') {
        $rows[] = $norm;
    }
}

$layoutKeys = [
    'priority_layout_json',
    'priority_theme_json',
    'bucket_layout_json',
    'bucket_labels_json',
];
$layoutRows = dt_app_settings_subset($pdo, $layoutKeys);
$biSettings = bi_load_settings($pdo);

$validation = bi_validate_rows($pdo, $rows, $biSettings, $layoutRows);
$validateOnly = !empty($in['validate_only']);

if (!$validation['ok']) {
    jsonResponse([
        'ok' => false,
        'imported' => 0,
        'errors' => $validation['errors'],
        'cell_errors' => $validation['cell_errors'],
        'grid_headers' => $validation['grid_headers'],
        'grid_rows' => $validation['grid_rows'],
    ]);
    exit;
}

if ($validateOnly) {
    jsonResponse([
        'ok' => true,
        'imported' => 0,
        'validated' => count($rows),
        'errors' => [],
    ]);
    exit;
}

try {
    $imported = bi_import_rows($pdo, $rows, $biSettings, $layoutRows);
    logMessage('INFO', 'tasks_bulk_import ok', ['count' => $imported]);
    jsonResponse(['ok' => true, 'imported' => $imported, 'errors' => []]);
} catch (Throwable $e) {
    logMessage('ERROR', 'tasks_bulk_import failed', ['message' => $e->getMessage()]);
    jsonError('Import failed: ' . $e->getMessage(), 500);
}
