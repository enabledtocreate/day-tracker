<?php
/**
 * Phase 4.5: Admin API – 403 for non-admin, 200 for admin.
 */
declare(strict_types=1);

require_once dirname(__DIR__) . '/ApiTestCase.php';
require_once dirname(__DIR__, 2) . '/lib/db.php';

final class AdminApiTest extends ApiTestCase
{
    public function testNonAdminGets403(): void
    {
        $master = getMasterPdo();
        $master->prepare('INSERT INTO users (username, password_hash, db_name, is_admin) VALUES (?, ?, ?, 0)')
            ->execute(['nonadmin', password_hash('x', PASSWORD_DEFAULT), 'test_user2.sqlite']);
        createTestUserDb($this->dataDir, 'test_user2.sqlite');
        $row = $master->query("SELECT id, username, db_name, is_admin FROM users WHERE username = 'nonadmin'")->fetch(PDO::FETCH_ASSOC);
        $row['force_password_reset'] = 0;
        $this->testUser = $row;

        $resSettings = $this->request('GET', 'admin', ['action' => 'settings']);
        $this->assertSame(403, $resSettings['code']);
        $resUsers = $this->request('GET', 'admin', ['action' => 'users']);
        $this->assertSame(403, $resUsers['code']);
    }

    public function testAdminGetsSettingsAndUsers(): void
    {
        $res = $this->request('GET', 'admin', ['action' => 'settings']);
        $this->assertSame(200, $res['code']);
        $this->assertArrayHasKey('debug', $res['body']);
        $this->assertArrayHasKey('ai_enabled', $res['body']);

        $resUsers = $this->request('GET', 'admin', ['action' => 'users']);
        $this->assertSame(200, $resUsers['code']);
        $this->assertArrayHasKey('users', $resUsers['body']);
        $this->assertIsArray($resUsers['body']['users']);
    }

    public function testAdminGetErrorLog(): void
    {
        $res = $this->request('GET', 'admin', ['action' => 'error_log']);
        $this->assertSame(200, $res['code']);
        $this->assertArrayHasKey('lines', $res['body']);
    }
}
