<?php
/**
 * Data integrity API: run verification/coercion rules on load.
 * GET: run all rules (fix invalid data), return summary.
 */
require_once __DIR__ . '/common.php';
require_once dirname(__DIR__) . '/lib/data_integrity.php';
require_once dirname(__DIR__) . '/lib/logger.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'GET') {
    jsonError('Method not allowed', 405);
    exit;
}

$pdo = getPdoSafe();
$result = dataIntegrityRunAll($pdo);
logMessage('INFO', 'data_integrity run', ['fixed_keys' => array_keys($result['fixed'])]);
jsonResponse($result);
