<?php
/**
 * Shared API helpers: JSON response, read body, require auth and user DB.
 */
require_once dirname(__DIR__) . '/lib/auth.php';
require_once dirname(__DIR__) . '/lib/db.php';
require_once dirname(__DIR__) . '/lib/logger.php';

requireAuth();

$user = getCurrentUser();
if ($user && ($user['username'] ?? '') === 'demo') {
    require_once dirname(__DIR__) . '/lib/demo_seed.php';
    $master = getMasterPdo();
    $lastReset = getDemoLastResetDate($master);
    $today = date('Y-m-d');
    if ($lastReset !== $today) {
        resetDemoUser($master, getDataDir());
        setDemoLastResetDate($master, $today);
    }
}

$user = getCurrentUser();
$userId = isset($user['id']) ? (int) $user['id'] : null;
logRequest($_SERVER['REQUEST_METHOD'] ?? 'GET', $_SERVER['REQUEST_URI'] ?? '', $userId);

// Log uncaught exceptions then return JSON 500
set_exception_handler(function (Throwable $e) {
    logError('ERROR', $e->getMessage(), [
        'file' => $e->getFile(),
        'line' => $e->getLine(),
        'trace' => $e->getTraceAsString(),
    ]);
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Internal Server Error', 'message' => $e->getMessage(), 'file' => $e->getFile(), 'line' => $e->getLine()]);
});

// Log PHP errors (warnings, notices, etc.); return false so PHP still runs its default
set_error_handler(function (int $severity, string $message, string $file, int $line): bool {
    $level = 'WARNING';
    if ($severity === E_ERROR || $severity === E_CORE_ERROR || $severity === E_COMPILE_ERROR || $severity === E_USER_ERROR) {
        $level = 'ERROR';
    } elseif ($severity === E_NOTICE || $severity === E_USER_NOTICE || $severity === E_STRICT) {
        $level = 'NOTICE';
    }
    logError($level, $message, ['file' => $file, 'line' => $line]);
    return false;
});

function jsonResponse(array $data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data);
}

function jsonError(string $message, int $status = 400): void {
    jsonResponse(['error' => $message], $status);
}

function readJsonInput(): ?array {
    if (getenv('DAYTRACKER_TEST') === '1' && isset($GLOBALS['_DAYTRACKER_TEST_RAW_INPUT'])) {
        $raw = $GLOBALS['_DAYTRACKER_TEST_RAW_INPUT'];
    } else {
        $raw = file_get_contents('php://input');
    }
    if ($raw === false || $raw === '' || $raw === null) {
        return null;
    }
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : null;
}

function getPdoSafe(): PDO {
    try {
        return getPdo();
    } catch (Throwable $e) {
        logError('ERROR', 'Database unavailable: ' . $e->getMessage(), [
            'file' => $e->getFile(),
            'line' => $e->getLine(),
            'trace' => $e->getTraceAsString(),
        ]);
        jsonError('Database not configured. Run install.php first.', 503);
        exit;
    }
}
