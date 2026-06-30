<?php
/**
 * Test helpers: create test master DB, user DB, set session user.
 * Used by API tests and database integration tests.
 */

function createTestMasterDb(string $dataDir): PDO {
    if (!is_dir($dataDir)) {
        mkdir($dataDir, 0755, true);
    }
    $masterPath = $dataDir . DIRECTORY_SEPARATOR . 'daytracker_master.sqlite';
    $pdo = new PDO('sqlite:' . $masterPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $migrationsDir = dirname(__DIR__) . '/migrations_master';
    if (!is_dir($migrationsDir)) {
        throw new RuntimeException('migrations_master not found');
    }
    require_once dirname(__DIR__) . '/lib/db.php';
    runMigrationsIn($pdo, $migrationsDir);
    return $pdo;
}

function createTestUserDb(string $dataDir, string $dbFileName): void {
    if (!is_dir($dataDir)) {
        mkdir($dataDir, 0755, true);
    }
    $userPath = $dataDir . DIRECTORY_SEPARATOR . $dbFileName;
    $pdo = new PDO('sqlite:' . $userPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $migrationsDir = dirname(__DIR__) . '/migrations';
    require_once dirname(__DIR__) . '/lib/db.php';
    runMigrationsIn($pdo, $migrationsDir);
}

function setTestSessionUser(array $user): void {
    if (session_status() === PHP_SESSION_NONE) {
        session_start();
    }
    $_SESSION['daytracker_user'] = [
        'id' => (int) $user['id'],
        'username' => $user['username'],
        'db_name' => $user['db_name'],
        'is_admin' => !empty($user['is_admin']),
        'force_password_reset' => !empty($user['force_password_reset']),
    ];
}

/**
 * Create test environment: temp dir, master DB with one user, user DB. Returns ['dataDir' => ..., 'user' => ...].
 */
function createTestEnvironment(): array {
    $dataDir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'daytracker_test_' . getmypid() . '_' . bin2hex(random_bytes(4));
    mkdir($dataDir, 0755, true);
    putenv('DAYTRACKER_TEST=1');
    putenv('DAYTRACKER_TEST_DATA_DIR=' . $dataDir);

    $master = createTestMasterDb($dataDir);
    $dbFileName = 'test_user.sqlite';
    createTestUserDb($dataDir, $dbFileName);
    $hash = password_hash('test', PASSWORD_DEFAULT);
    $master->prepare('INSERT INTO users (username, password_hash, db_name, is_admin) VALUES (?, ?, ?, 1)')
        ->execute(['test', $hash, $dbFileName]);
    $userId = (int) $master->lastInsertId();
    $stmt = $master->query("SELECT id, username, db_name, is_admin FROM users WHERE id = " . $userId);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    $row['force_password_reset'] = 0;
    setTestSessionUser($row);

    return ['dataDir' => $dataDir, 'user' => $row];
}

/**
 * Run an API script in a subprocess (see tests/api_request_harness.php) so exit() in api/*.php does not kill PHPUnit.
 *
 * @param array<string,mixed>|null $sessionUser Session row for daytracker_user, or null for an empty session (401 tests).
 * @param mixed $body Request body for POST/PATCH/PUT (array is JSON-encoded).
 * @return array{body: mixed, code: int}
 */
function runApiRequestHarness(string $dataDir, ?array $sessionUser, string $scriptName, string $method, array $query, $body, array $extra = []): array {
    $root = dirname(__DIR__);
    $payload = array_merge([
        'dataDir' => $dataDir,
        'user' => $sessionUser,
        'script' => $scriptName,
        'method' => $method,
        'query' => $query,
        'body' => $body,
    ], $extra);
    $tmp = tempnam(sys_get_temp_dir(), 'dt_req_');
    if ($tmp === false) {
        throw new RuntimeException('tempnam failed');
    }
    file_put_contents($tmp, json_encode($payload));

    $cmd = [PHP_BINARY];
    $ini = $root . DIRECTORY_SEPARATOR . 'php.ini';
    if (is_file($ini)) {
        $cmd[] = '-c';
        $cmd[] = $ini;
    }
    $cmd[] = $root . DIRECTORY_SEPARATOR . 'tests' . DIRECTORY_SEPARATOR . 'api_request_harness.php';
    $cmd[] = $tmp;

    $proc = proc_open($cmd, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, $root);
    if (!is_resource($proc)) {
        @unlink($tmp);
        throw new RuntimeException('proc_open failed');
    }
    fclose($pipes[0]);
    $stdout = (string) stream_get_contents($pipes[1]);
    $stderr = (string) stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    proc_close($proc);
    @unlink($tmp);

    if ($stderr !== '' && getenv('DAYTRACKER_API_TEST_DEBUG') === '1') {
        file_put_contents('php://stderr', $stderr);
    }

    $code = 200;
    $output = $stdout;
    if (preg_match('/^__DT_STATUS__:(\d+)\r?\n/', $stdout, $m)) {
        $code = (int) $m[1];
        $output = substr($stdout, strlen($m[0]));
    }

    $decoded = @json_decode($output, true);
    return [
        'body' => $decoded !== null ? $decoded : $output,
        'code' => $code,
    ];
}
