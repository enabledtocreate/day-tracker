<?php
/**
 * Phase 4.9: Auth – 401 without session, 200 with session.
 */
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once dirname(__DIR__) . '/TestHelper.php';

final class AuthApiTest extends TestCase
{
    public function testGetTasksWithoutSessionReturns401(): void
    {
        putenv('DAYTRACKER_TEST=1');
        $dataDir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'daytracker_auth_test_' . getmypid();
        if (!is_dir($dataDir)) {
            mkdir($dataDir, 0755, true);
        }
        putenv('DAYTRACKER_TEST_DATA_DIR=' . $dataDir);
        createTestMasterDb($dataDir);
        createTestUserDb($dataDir, 'test_user.sqlite');
        $master = new PDO('sqlite:' . $dataDir . '/daytracker_master.sqlite', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $master->prepare('INSERT INTO users (username, password_hash, db_name, is_admin) VALUES (?, ?, ?, 1)')
            ->execute(['test', password_hash('test', PASSWORD_DEFAULT), 'test_user.sqlite']);
        $_SESSION = [];
        if (session_status() === PHP_SESSION_NONE) {
            session_start();
        }
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = '/api/tasks.php';
        $_GET = [];
        ob_start();
        try {
            require dirname(__DIR__, 2) . '/api/tasks.php';
        } catch (Throwable $e) {
            ob_end_clean();
            putenv('DAYTRACKER_TEST_DATA_DIR');
            throw $e;
        }
        $output = ob_get_clean();
        $code = http_response_code();
        putenv('DAYTRACKER_TEST_DATA_DIR');
        $this->assertSame(401, $code);
        $decoded = json_decode($output, true);
        $this->assertIsArray($decoded);
        $this->assertArrayHasKey('error', $decoded);
    }

    public function testGetTasksWithSessionReturns200(): void
    {
        $env = createTestEnvironment();
        putenv('DAYTRACKER_TEST_DATA_DIR=' . $env['dataDir']);
        $apiDir = dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'api';
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = '/api/tasks.php';
        $_GET = [];
        ob_start();
        require $apiDir . '/tasks.php';
        $output = ob_get_clean();
        $code = http_response_code();
        $this->assertSame(200, $code);
        $decoded = json_decode($output, true);
        $this->assertArrayHasKey('tasks', $decoded);
        if (is_dir($env['dataDir'])) {
            array_map('unlink', glob($env['dataDir'] . '/*'));
            @rmdir($env['dataDir']);
        }
        putenv('DAYTRACKER_TEST_DATA_DIR');
    }
}
