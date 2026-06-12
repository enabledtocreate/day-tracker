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

        $res = runApiRequestHarness($dataDir, null, 'tasks.php', 'GET', [], null);
        putenv('DAYTRACKER_TEST_DATA_DIR');
        $this->assertSame(401, $res['code']);
        $this->assertIsArray($res['body']);
        $this->assertArrayHasKey('error', $res['body']);

        if (is_dir($dataDir)) {
            $files = new RecursiveIteratorIterator(
                new RecursiveDirectoryIterator($dataDir, RecursiveDirectoryIterator::SKIP_DOTS),
                RecursiveIteratorIterator::CHILD_FIRST
            );
            foreach ($files as $file) {
                $file->isDir() ? rmdir($file->getPathname()) : unlink($file->getPathname());
            }
            @rmdir($dataDir);
        }
    }

    public function testGetTasksWithSessionReturns200(): void
    {
        $env = createTestEnvironment();
        putenv('DAYTRACKER_TEST_DATA_DIR=' . $env['dataDir']);
        $res = runApiRequestHarness($env['dataDir'], $env['user'], 'tasks.php', 'GET', [], null);
        $this->assertSame(200, $res['code']);
        $this->assertIsArray($res['body']);
        $this->assertArrayHasKey('tasks', $res['body']);

        if (is_dir($env['dataDir'])) {
            $files = new RecursiveIteratorIterator(
                new RecursiveDirectoryIterator($env['dataDir'], RecursiveDirectoryIterator::SKIP_DOTS),
                RecursiveIteratorIterator::CHILD_FIRST
            );
            foreach ($files as $file) {
                $file->isDir() ? rmdir($file->getPathname()) : unlink($file->getPathname());
            }
            @rmdir($env['dataDir']);
        }
        putenv('DAYTRACKER_TEST_DATA_DIR');
    }
}
