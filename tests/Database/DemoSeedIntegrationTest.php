<?php
/**
 * Phase 2.2: Demo seed integration. Temp data dir, master + demo user, resetDemoUser, assert seeded data.
 */
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once dirname(__DIR__) . '/TestHelper.php';
require_once dirname(__DIR__, 2) . '/lib/demo_seed.php';

final class DemoSeedIntegrationTest extends TestCase
{
    private string $dataDir;
    private PDO $master;

    protected function setUp(): void
    {
        parent::setUp();
        $this->dataDir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'daytracker_demoseed_test_' . getmypid() . '_' . bin2hex(random_bytes(4));
        mkdir($this->dataDir, 0755, true);
        putenv('DAYTRACKER_TEST=1');
        putenv('DAYTRACKER_TEST_DATA_DIR=' . $this->dataDir);
        $this->master = createTestMasterDb($this->dataDir);
        ensureDemoUserExists($this->master, $this->dataDir);
    }

    protected function tearDown(): void
    {
        putenv('DAYTRACKER_TEST_DATA_DIR');
        if (isset($this->dataDir) && is_dir($this->dataDir)) {
            $files = new \RecursiveIteratorIterator(
                new \RecursiveDirectoryIterator($this->dataDir, \RecursiveDirectoryIterator::SKIP_DOTS),
                \RecursiveIteratorIterator::CHILD_FIRST
            );
            foreach ($files as $file) {
                $file->isDir() ? @rmdir($file->getPathname()) : @unlink($file->getPathname());
            }
            @rmdir($this->dataDir);
        }
        parent::tearDown();
    }

    public function testResetDemoUserCreatesDayRecords(): void
    {
        resetDemoUser($this->master, $this->dataDir);
        $row = $this->master->query("SELECT db_name FROM users WHERE username = 'demo'")->fetch(PDO::FETCH_ASSOC);
        $this->assertNotEmpty($row);
        $userPath = $this->dataDir . '/' . $row['db_name'];
        $pdo = new PDO('sqlite:' . $userPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $count = (int) $pdo->query('SELECT COUNT(*) FROM day_record')->fetchColumn();
        $this->assertGreaterThanOrEqual(14, $count, 'day_record should have at least 14 days (7 past, today, 6 future)');
    }

    public function testResetDemoUserCreatesTasksWithMixedListState(): void
    {
        resetDemoUser($this->master, $this->dataDir);
        $row = $this->master->query("SELECT db_name FROM users WHERE username = 'demo'")->fetch(PDO::FETCH_ASSOC);
        $pdo = new PDO('sqlite:' . $this->dataDir . '/' . $row['db_name'], null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $pending = (int) $pdo->query("SELECT COUNT(*) FROM tasks WHERE list_state = 'pending'")->fetchColumn();
        $unassigned = (int) $pdo->query("SELECT COUNT(*) FROM tasks WHERE list_state = 'unassigned'")->fetchColumn();
        $this->assertGreaterThan(0, $pending, 'Some tasks should be pending');
        $this->assertGreaterThan(0, $unassigned, 'Some tasks should be unassigned');
    }

    public function testResetDemoUserCreatesScheduledSlotsForTodayAndYesterdayWithEvening(): void
    {
        resetDemoUser($this->master, $this->dataDir);
        $row = $this->master->query("SELECT db_name FROM users WHERE username = 'demo'")->fetch(PDO::FETCH_ASSOC);
        $pdo = new PDO('sqlite:' . $this->dataDir . '/' . $row['db_name'], null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $today = date('Y-m-d');
        $yesterday = date('Y-m-d', strtotime($today . ' -1 day'));
        $dayIds = [];
        foreach ($pdo->query('SELECT id, date FROM day_record')->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $dayIds[$r['date']] = (int) $r['id'];
        }
        $todayId = $dayIds[$today] ?? null;
        $yesterdayId = $dayIds[$yesterday] ?? null;
        $this->assertNotNull($todayId, 'Today should be in day_record');
        $this->assertNotNull($yesterdayId, 'Yesterday should be in day_record');
        $stmt = $pdo->prepare('SELECT COUNT(*) FROM scheduled_slots WHERE day_record_id = ?');
        $stmt->execute([$todayId]);
        $slotsToday = (int) $stmt->fetchColumn();
        $stmt = $pdo->prepare('SELECT COUNT(*) FROM scheduled_slots WHERE day_record_id = ?');
        $stmt->execute([$yesterdayId]);
        $slotsYesterday = (int) $stmt->fetchColumn();
        $this->assertGreaterThan(0, $slotsToday, 'Today should have scheduled slots');
        $this->assertGreaterThan(0, $slotsYesterday, 'Yesterday should have scheduled slots');
        $stmt = $pdo->prepare("SELECT COUNT(*) FROM scheduled_slots s JOIN day_record d ON d.id = s.day_record_id WHERE (s.start_time IS NULL OR s.start_time >= '18:00') AND d.date IN (?, ?)");
        $stmt->execute([$today, $yesterday]);
        $evening = (int) $stmt->fetchColumn();
        $this->assertGreaterThan(0, $evening, 'There should be evening slots for today or yesterday');
    }

    public function testResetDemoUserCreatesTaskLinksAndTaskListItems(): void
    {
        resetDemoUser($this->master, $this->dataDir);
        $row = $this->master->query("SELECT db_name FROM users WHERE username = 'demo'")->fetch(PDO::FETCH_ASSOC);
        $pdo = new PDO('sqlite:' . $this->dataDir . '/' . $row['db_name'], null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $links = (int) $pdo->query('SELECT COUNT(*) FROM task_links')->fetchColumn();
        $items = (int) $pdo->query('SELECT COUNT(*) FROM task_list_items')->fetchColumn();
        $this->assertGreaterThan(0, $links, 'At least one task should have links');
        $this->assertGreaterThan(0, $items, 'At least one task should have task_list_items');
    }

    public function testResetDemoUserCreatesRecurringTasks(): void
    {
        resetDemoUser($this->master, $this->dataDir);
        $row = $this->master->query("SELECT db_name FROM users WHERE username = 'demo'")->fetch(PDO::FETCH_ASSOC);
        $pdo = new PDO('sqlite:' . $this->dataDir . '/' . $row['db_name'], null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $recurring = (int) $pdo->query('SELECT COUNT(*) FROM tasks WHERE recurring = 1')->fetchColumn();
        $this->assertGreaterThan(0, $recurring, 'Recurring tasks should be present');
    }
}
