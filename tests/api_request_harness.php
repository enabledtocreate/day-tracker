<?php
/**
 * CLI harness for API integration tests: runs each request in a separate PHP process so api/*.php can exit without killing PHPUnit.
 *
 * Usage: php -c php.ini tests/api_request_harness.php <path-to-payload.json>
 *
 * Payload JSON:
 * { "dataDir": string, "user": { id, username, db_name, is_admin, force_password_reset }, "script": "settings.php", "method": "GET", "query": {}, "body": null | object }
 */
declare(strict_types=1);

if ($argc < 2) {
    fwrite(STDERR, "usage: php tests/api_request_harness.php <payload.json>\n");
    exit(2);
}

$payloadPath = $argv[1];
$raw = @file_get_contents($payloadPath);
$payload = is_string($raw) ? json_decode($raw, true) : null;
if (!is_array($payload)) {
    fwrite(STDERR, "invalid payload JSON\n");
    exit(2);
}

putenv('DAYTRACKER_TEST=1');
putenv('DAYTRACKER_TEST_SUBPROCESS=1');
$dataDir = $payload['dataDir'] ?? '';
if ($dataDir === '' || !is_dir($dataDir)) {
    fwrite(STDERR, "invalid dataDir\n");
    exit(2);
}
putenv('DAYTRACKER_TEST_DATA_DIR=' . $dataDir);

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/TestHelper.php';

if (array_key_exists('user', $payload) && $payload['user'] === null) {
    if (session_status() === PHP_SESSION_NONE) {
        session_start();
    }
    $_SESSION = [];
} elseif (is_array($payload['user'] ?? null)) {
    setTestSessionUser($payload['user']);
    if (array_key_exists('session_expires_at', $payload)) {
        $_SESSION['daytracker_expiry_init'] = true;
        if ($payload['session_expires_at'] === null) {
            unset($_SESSION['daytracker_expires_at']);
        } else {
            $_SESSION['daytracker_expires_at'] = (int) $payload['session_expires_at'];
        }
    }
} else {
    fwrite(STDERR, "missing user (or null for no session)\n");
    exit(2);
}

$scriptName = $payload['script'] ?? '';
if (
    !is_string($scriptName) || $scriptName === ''
    || strpos($scriptName, '..') !== false
    || !preg_match('#^[a-zA-Z0-9_./-]+\\.php$#', $scriptName)
) {
    fwrite(STDERR, "invalid script name\n");
    exit(2);
}

$method = strtoupper((string) ($payload['method'] ?? 'GET'));
$query = is_array($payload['query'] ?? null) ? $payload['query'] : [];
$body = array_key_exists('body', $payload) ? $payload['body'] : null;

$_SERVER['REQUEST_METHOD'] = $method;
$_SERVER['REQUEST_URI'] = '/api/' . $scriptName . ($query ? '?' . http_build_query($query) : '');
$_GET = $query;
$_POST = [];

$GLOBALS['_DAYTRACKER_TEST_RAW_INPUT'] = null;
if ($body !== null && in_array($method, ['POST', 'PATCH', 'PUT'], true)) {
    $GLOBALS['_DAYTRACKER_TEST_RAW_INPUT'] = is_string($body) ? $body : json_encode($body);
}

$root = dirname(__DIR__);
$scriptPath = $root . DIRECTORY_SEPARATOR . 'api' . DIRECTORY_SEPARATOR . $scriptName;
if (!is_file($scriptPath)) {
    fwrite(STDERR, 'API script not found: ' . $scriptPath . "\n");
    exit(2);
}

require $scriptPath;
