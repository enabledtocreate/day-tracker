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

    public function testResetDemoUserSeedsOrganizationDataWhenTablesExist(): void
    {
        resetDemoUser($this->master, $this->dataDir);
        $row = $this->master->query("SELECT db_name FROM users WHERE username = 'demo'")->fetch(PDO::FETCH_ASSOC);
        $pdo = new PDO('sqlite:' . $this->dataDir . '/' . $row['db_name'], null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $hasCategories = $pdo->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_categories'")->fetchColumn();
        if (!$hasCategories) {
            $this->markTestSkipped('Organization tables (migration 016) not present');
        }
        $categories = (int) $pdo->query('SELECT COUNT(*) FROM task_categories')->fetchColumn();
        $this->assertGreaterThanOrEqual(3, $categories, 'Demo should seed at least 3 categories (Work, Personal, Health)');
        $taskCategoryRows = (int) $pdo->query('SELECT COUNT(*) FROM task_category')->fetchColumn();
        $this->assertGreaterThan(0, $taskCategoryRows, 'At least one task should have a category assigned');
    }

    public function testResetDemoUserSeedsCommonTasksAndScheduleBlocks(): void
    {
        resetDemoUser($this->master, $this->dataDir);
        $row = $this->master->query("SELECT db_name FROM users WHERE username = 'demo'")->fetch(PDO::FETCH_ASSOC);
        $pdo = new PDO('sqlite:' . $this->dataDir . '/' . $row['db_name'], null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $hasIsCommon = in_array('is_common', array_column($pdo->query('PRAGMA table_info(tasks)')->fetchAll(PDO::FETCH_ASSOC), 'name'), true);
        if (!$hasIsCommon) {
            $this->markTestSkipped('is_common column not present');
        }
        $common = (int) $pdo->query('SELECT COUNT(*) FROM tasks WHERE is_common = 1')->fetchColumn();
        $this->assertGreaterThanOrEqual(3, $common, 'Demo should seed Common Tasks templates');

        $hasScheduleBlocks = $pdo->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schedule_blocks'")->fetchColumn();
        if (!$hasScheduleBlocks) {
            $this->markTestSkipped('schedule_blocks table not present');
        }
        $blocks = (int) $pdo->query('SELECT COUNT(*) FROM schedule_blocks')->fetchColumn();
        $this->assertGreaterThan(0, $blocks, 'Demo should seed schedule block instances');
        $blockTypes = (int) $pdo->query('SELECT COUNT(*) FROM task_blocks')->fetchColumn();
        $this->assertGreaterThanOrEqual(3, $blockTypes, 'Demo should seed block types');
    }

    public function testResetDemoUserSeedsTaskGroupOnSchedule(): void
    {
        resetDemoUser($this->master, $this->dataDir);
        $row = $this->master->query("SELECT db_name FROM users WHERE username = 'demo'")->fetch(PDO::FETCH_ASSOC);
        $pdo = new PDO('sqlite:' . $this->dataDir . '/' . $row['db_name'], null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $rootId = (int) $pdo->query("SELECT id FROM tasks WHERE title = 'Client launch'")->fetchColumn();
        $this->assertGreaterThan(0, $rootId);
        $memberStmt = $pdo->prepare('SELECT COUNT(*) FROM tasks WHERE parent_id = ?');
        $memberStmt->execute([$rootId]);
        $this->assertSame(2, (int) $memberStmt->fetchColumn());
        $today = date('Y-m-d');
        $dayStmt = $pdo->prepare('SELECT id FROM day_record WHERE date = ?');
        $dayStmt->execute([$today]);
        $dayId = (int) $dayStmt->fetchColumn();
        $slotStmt = $pdo->prepare(
            'SELECT COUNT(*) FROM scheduled_slots s JOIN tasks t ON t.id = s.task_id WHERE s.day_record_id = ? AND (t.id = ? OR t.parent_id = ?)'
        );
        $slotStmt->execute([$dayId, $rootId, $rootId]);
        $this->assertSame(3, (int) $slotStmt->fetchColumn(), 'Client launch group should have root + 2 member slots today');
    }
}
