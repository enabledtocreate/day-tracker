<?php
/**
 * Run pending migrations manually. Requires auth.
 * GET: runs migrations (via getPdo) and returns { ok: true, applied: [...] }.
 */
require_once dirname(__DIR__) . '/api/common.php';

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
    jsonError('Method not allowed', 405);
}

try {
    getPdo();
    $applied = getLastAppliedMigrations();
    jsonResponse(['ok' => true, 'applied' => $applied]);
} catch (Throwable $e) {
    logError('ERROR', 'Migration failed: ' . $e->getMessage(), ['file' => $e->getFile(), 'line' => $e->getLine()]);
    jsonError($e->getMessage(), 500);
}
