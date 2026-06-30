<?php
/**
 * Session lifetime and expiry: 401 session_expired when past expires_at.
 */
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once dirname(__DIR__) . '/TestHelper.php';

final class SessionAuthTest extends TestCase
{
    public function testExpiredSessionReturns401WithSessionExpiredCode(): void
    {
        $env = createTestEnvironment();
        putenv('DAYTRACKER_TEST_DATA_DIR=' . $env['dataDir']);

        $res = runApiRequestHarness($env['dataDir'], $env['user'], 'tasks.php', 'GET', [], null, [
            'session_expires_at' => time() - 60,
        ]);
        $this->assertSame(401, $res['code']);
        $this->assertIsArray($res['body']);
        $this->assertSame('session_expired', $res['body']['code'] ?? null);

        $this->cleanup($env['dataDir']);
        putenv('DAYTRACKER_TEST_DATA_DIR');
    }

    public function testUpdateSessionLifetimeViaUserApi(): void
    {
        $env = createTestEnvironment();
        putenv('DAYTRACKER_TEST_DATA_DIR=' . $env['dataDir']);

        $res = runApiRequestHarness($env['dataDir'], $env['user'], 'user.php', 'PATCH', [], [
            'session_lifetime_days' => 7,
        ]);
        $this->assertSame(200, $res['code']);
        $this->assertIsArray($res['body']);
        $this->assertSame(7, $res['body']['session_lifetime_days'] ?? null);
        $this->assertNotEmpty($res['body']['session_expires_at'] ?? null);

        $master = new PDO('sqlite:' . $env['dataDir'] . '/daytracker_master.sqlite', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $stmt = $master->prepare('SELECT session_lifetime_days FROM users WHERE id = ?');
        $stmt->execute([(int) $env['user']['id']]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        $this->assertSame('7', (string) ($row['session_lifetime_days'] ?? ''));

        $this->cleanup($env['dataDir']);
        putenv('DAYTRACKER_TEST_DATA_DIR');
    }

    private function cleanup(string $dataDir): void
    {
        if (!is_dir($dataDir)) {
            return;
        }
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
