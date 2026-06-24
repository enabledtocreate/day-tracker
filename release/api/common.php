<?php
/**
 * Shared API helpers: JSON response, read body, require auth and user DB.
 */
require_once dirname(__DIR__) . '/lib/auth.php';
require_once dirname(__DIR__) . '/lib/db.php';
require_once dirname(__DIR__) . '/lib/logger.php';
require_once dirname(__DIR__) . '/lib/api_error_bootstrap.php';

daytracker_register_fatal_shutdown_logger();

function jsonResponse(array $data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    /** @see tests/api_request_harness.php — subprocess API tests read this line to recover HTTP status (scripts still call exit). */
    if (getenv('DAYTRACKER_TEST_SUBPROCESS') === '1') {
        echo '__DT_STATUS__:' . $status . "\n";
    }
    echo json_encode($data);
}

function jsonError(string $message, int $status = 400): void
{
    if (getenv('DAYTRACKER_TEST') !== '1') {
        $uri = (string) ($_SERVER['REQUEST_URI'] ?? '');
        $method = (string) ($_SERVER['REQUEST_METHOD'] ?? '');
        $ctx = ['status' => $status, 'message' => $message, 'method' => $method, 'uri' => $uri];
        if ($status >= 500) {
            logError('ERROR', 'API jsonError', $ctx);
        } elseif (in_array($status, [401, 403, 404, 405, 413, 429], true)) {
            logError('WARNING', 'API jsonError', $ctx);
        }
        // Deliberately omit routine 400 validation responses to avoid log noise.
    }
    jsonResponse(['error' => $message], $status);
}

function readJsonInput(): ?array
{
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

function getPdoSafe(): PDO
{
    try {
        return getPdo();
    } catch (Throwable $e) {
        logError('ERROR', 'Database unavailable: ' . $e->getMessage(), [
            'file' => $e->getFile(),
            'line' => $e->getLine(),
            'trace' => $e->getTraceAsString(),
        ]);
        $message = 'Database not configured. Run install.php first.';
        if (function_exists('isAdmin') && isAdmin()) {
            $message = 'Database error: ' . $e->getMessage();
        }
        jsonError($message, 503);
        exit;
    }
}

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
    if (getenv('DAYTRACKER_TEST_SUBPROCESS') === '1') {
        echo '__DT_STATUS__:500' . "\n";
    }
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
