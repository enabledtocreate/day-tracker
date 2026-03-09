<?php
/**
 * Phase 8: Security smoke – session user sees only own data; no cross-user leak.
 */
declare(strict_types=1);

require_once dirname(__DIR__) . '/ApiTestCase.php';
require_once dirname(__DIR__, 2) . '/lib/db.php';

final class SecurityApiTest extends ApiTestCase
{
    public function testSessionUserSeesOnlyOwnTasks(): void
    {
        $master = getMasterPdo();
        $dbB = 'test_user_b.sqlite';
        createTestUserDb($this->dataDir, $dbB);
        $master->prepare('INSERT INTO users (username, password_hash, db_name, is_admin) VALUES (?, ?, ?, 0)')
            ->execute(['userb', password_hash('b', PASSWORD_DEFAULT), $dbB]);

        $resA = $this->request('POST', 'tasks', [], ['title' => 'Task for user A']);
        $this->assertSame(200, $resA['code']);
        $resListA = $this->request('GET', 'tasks');
        $this->assertSame(200, $resListA['code']);
        $tasksA = $resListA['body']['tasks'];
        $this->assertCount(1, $tasksA);
        $this->assertSame('Task for user A', $tasksA[0]['title']);

        $rowB = $master->query("SELECT id, username, db_name, is_admin FROM users WHERE username = 'userb'")->fetch(PDO::FETCH_ASSOC);
        $rowB['force_password_reset'] = 0;
        setTestSessionUser($rowB);

        $resListB = $this->request('GET', 'tasks');
        $this->assertSame(200, $resListB['code']);
        $tasksB = $resListB['body']['tasks'];
        $this->assertCount(0, $tasksB, 'User B must not see user A tasks');
    }
}
