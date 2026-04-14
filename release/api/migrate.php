<?php
/**
 * Run pending migrations manually. Requires auth.
 * GET: runs migrations (via getPdo) and returns { ok: true, applied: [...] }.
 */
require_once dirname(__DIR__) . '/lib/auth.php';
require_once dirname(__DIR__) . '/lib/db.php';
require_once dirname(__DIR__) . '/lib/logger.php';
require_once dirname(__DIR__) . '/lib/api_error_bootstrap.php';

daytracker_register_fatal_shutdown_logger();

requireAuth();

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
    header('Allow: GET', true, 405);
    exit;
}

header('Content-Type: application/json; charset=utf-8');

try {
    getPdo();
    $applied = getLastAppliedMigrations();
    echo json_encode(['ok' => true, 'applied' => $applied]);
} catch (Throwable $e) {
    http_response_code(500);
    logError('ERROR', 'Migration failed: ' . $e->getMessage(), ['file' => $e->getFile(), 'line' => $e->getLine()]);
    echo json_encode(['error' => $e->getMessage()]);
}
