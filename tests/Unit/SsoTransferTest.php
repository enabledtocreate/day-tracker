<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once dirname(__DIR__, 2) . '/lib/db.php';
require_once dirname(__DIR__, 2) . '/lib/sso_transfer.php';

final class SsoTransferTest extends TestCase
{
    private string $dataDir;
    private PDO $master;

    protected function setUp(): void
    {
        parent::setUp();
        $this->dataDir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'daytracker_sso_xfer_' . getmypid() . '_' . uniqid('', true);
        mkdir($this->dataDir, 0755, true);
        putenv('DAYTRACKER_TEST=1');
        putenv('DAYTRACKER_TEST_DATA_DIR=' . $this->dataDir);

        $masterPath = $this->dataDir . DIRECTORY_SEPARATOR . 'daytracker_master.sqlite';
        $this->master = new PDO('sqlite:' . $masterPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $sql = file_get_contents(dirname(__DIR__, 2) . '/migrations_master/001_initial.sql');
        $this->master->exec($sql);
    }

    protected function tearDown(): void
    {
        putenv('DAYTRACKER_TEST');
        putenv('DAYTRACKER_TEST_DATA_DIR');
        parent::tearDown();
    }

    public function testTransferMovesProviderSubToTargetAccount(): void
    {
        $this->master->exec("INSERT INTO users (username, password_hash, db_name) VALUES ('alice', 'hash', 'a.sqlite')");
        $this->master->exec("INSERT INTO users (username, password_hash, db_name) VALUES ('bob', 'hash', 'b.sqlite')");
        $aliceId = (int) $this->master->query("SELECT id FROM users WHERE username='alice'")->fetchColumn();
        $bobId = (int) $this->master->query("SELECT id FROM users WHERE username='bob'")->fetchColumn();

        $this->master->prepare(
            'INSERT INTO sso_accounts (master_user_id, provider, email, sub) VALUES (?, ?, ?, ?)'
        )->execute([$aliceId, 'google', 'a@test.com', 'sub-123']);

        $this->assertTrue(ssoUserHasPassword($this->master, $aliceId));
        $this->assertTrue(ssoUserHasPassword($this->master, $bobId));

        ssoTransferExecute($this->master, $bobId, [
            'provider' => 'google',
            'sub' => 'sub-123',
            'email' => 'a@test.com',
            'access_token' => 'tok',
            'refresh_token' => null,
            'token_expires_at' => null,
        ]);

        $onAlice = $this->master->prepare('SELECT COUNT(*) FROM sso_accounts WHERE master_user_id = ?');
        $onAlice->execute([$aliceId]);
        $this->assertSame(0, (int) $onAlice->fetchColumn());

        $onBob = $this->master->prepare('SELECT email FROM sso_accounts WHERE master_user_id = ? AND provider = ?');
        $onBob->execute([$bobId, 'google']);
        $this->assertSame('a@test.com', $onBob->fetchColumn());
    }

    public function testSsoOnlyAccountHasNoPassword(): void
    {
        $this->master->exec("INSERT INTO users (username, password_hash, db_name) VALUES ('sso_only', NULL, 's.sqlite')");
        $id = (int) $this->master->query("SELECT id FROM users WHERE username='sso_only'")->fetchColumn();
        $this->assertFalse(ssoUserHasPassword($this->master, $id));
    }
}
