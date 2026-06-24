<?php
/**
 * Phase 2.1: Migrations test. Run user DB migrations and assert schema.
 */
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once dirname(__DIR__, 2) . '/lib/db.php';

final class MigrationsTest extends TestCase
{
    private string $migrationsDir;
    private string $tempDbPath;
    private PDO $pdo;

    protected function setUp(): void
    {
        parent::setUp();
        $this->migrationsDir = dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'migrations';
        $this->tempDbPath = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'daytracker_migrations_test_' . getmypid() . '_' . bin2hex(random_bytes(4)) . '.sqlite';
        $this->pdo = new PDO('sqlite:' . $this->tempDbPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    }

    protected function tearDown(): void
    {
        if (isset($this->tempDbPath) && is_file($this->tempDbPath)) {
            @unlink($this->tempDbPath);
        }
        parent::tearDown();
    }

    public function testAllMigrationsAreRecorded(): void
    {
        runMigrationsIn($this->pdo, $this->migrationsDir);
        $files = glob($this->migrationsDir . '/*.sql');
        $expected = array_map('basename', $files);
        sort($expected);

        $stmt = $this->pdo->query('SELECT filename FROM schema_migrations ORDER BY filename');
        $recorded = $stmt ? $stmt->fetchAll(PDO::FETCH_COLUMN) : [];
        $this->assertSame($expected, $recorded, 'All migration files should be in schema_migrations');
    }

    public function testRequiredTablesExist(): void
    {
        runMigrationsIn($this->pdo, $this->migrationsDir);
        $tables = ['tasks', 'task_links', 'day_record', 'scheduled_slots', 'task_list_items'];
        foreach ($tables as $table) {
            $stmt = $this->pdo->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=" . $this->pdo->quote($table));
            $this->assertTrue($stmt && $stmt->fetch(), "Table $table should exist");
        }
    }

    public function testTasksHasRecurrenceRuleAndListState(): void
    {
        runMigrationsIn($this->pdo, $this->migrationsDir);
        $cols = $this->pdo->query('PRAGMA table_info(tasks)')->fetchAll(PDO::FETCH_ASSOC);
        $names = array_column($cols, 'name');
        $this->assertContains('recurrence_rule', $names, 'tasks.recurrence_rule (009)');
        $this->assertContains('list_state', $names, 'tasks.list_state (002)');
    }

    public function testScheduledSlotsStartTimeEndTimeNullable(): void
    {
        runMigrationsIn($this->pdo, $this->migrationsDir);
        $cols = $this->pdo->query('PRAGMA table_info(scheduled_slots)')->fetchAll(PDO::FETCH_ASSOC);
        $byName = [];
        foreach ($cols as $c) {
            $byName[$c['name']] = (int) $c['notnull'];
        }
        $this->assertSame(0, $byName['start_time'] ?? 1, 'scheduled_slots.start_time should be nullable (010)');
        $this->assertSame(0, $byName['end_time'] ?? 1, 'scheduled_slots.end_time should be nullable (010)');
    }

    public function testAccomplishedTableDropped(): void
    {
        runMigrationsIn($this->pdo, $this->migrationsDir);
        $stmt = $this->pdo->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='accomplished'");
        $this->assertFalse($stmt && $stmt->fetch(), 'Legacy accomplished table should be dropped (011)');
    }

    public function testMigrationsAreIdempotent(): void
    {
        runMigrationsIn($this->pdo, $this->migrationsDir);
        runMigrationsIn($this->pdo, $this->migrationsDir);
        $stmt = $this->pdo->query('SELECT COUNT(*) FROM schema_migrations');
        $count = $stmt ? (int) $stmt->fetchColumn() : 0;
        $files = glob($this->migrationsDir . '/*.sql');
        $this->assertSame(count($files), $count, 'Second migration run should not duplicate records');
    }
}
