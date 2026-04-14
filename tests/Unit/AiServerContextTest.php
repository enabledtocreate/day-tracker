<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once dirname(__DIR__, 2) . '/lib/ai_server_context.php';

final class AiServerContextTest extends TestCase
{
    private function minimalPdo(): PDO
    {
        $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $pdo->exec('CREATE TABLE day_record (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL UNIQUE)');
        $pdo->exec(
            'CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, priority TEXT, recurring INTEGER NOT NULL DEFAULT 0, parent_id INTEGER, list_state TEXT, list_style TEXT)'
        );
        $pdo->exec(
            'CREATE TABLE scheduled_slots (id INTEGER PRIMARY KEY AUTOINCREMENT, day_record_id INTEGER NOT NULL, task_id INTEGER NOT NULL, start_time TEXT, end_time TEXT, completed INTEGER NOT NULL DEFAULT 0, order_index INTEGER)'
        );
        $pdo->exec('CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT)');
        $pdo->exec("INSERT INTO app_settings (key, value) VALUES ('start_hour','8'), ('end_hour','18'), ('increment_value','30'), ('increment_unit','min'), ('timezone','')");
        $pdo->exec('INSERT INTO tasks (title, priority, recurring, parent_id) VALUES (\'T1\', \'medium\', 0, NULL)');
        $pdo->exec("INSERT INTO day_record (date) VALUES ('2026-04-01')");
        $dayId = (int) $pdo->lastInsertId();
        $pdo->prepare('INSERT INTO scheduled_slots (day_record_id, task_id, start_time, end_time, completed, order_index) VALUES (?,?,?,?,?,?)')
            ->execute([$dayId, 1, '09:00', '09:30', 0, 0]);
        return $pdo;
    }

    public function testBuildServerTaskContextHasExpectedKeys(): void
    {
        $pdo = $this->minimalPdo();
        $ctx = ai_build_server_task_context($pdo, '2026-04-01', []);
        $this->assertSame('2026-04-01', $ctx['date']);
        $this->assertArrayHasKey('taskList', $ctx);
        $this->assertArrayHasKey('slotsToday', $ctx);
        $this->assertArrayHasKey('unaccomplishedToday', $ctx);
        $this->assertArrayHasKey('organization', $ctx);
        $this->assertArrayHasKey('scheduleSettings', $ctx);
        $this->assertCount(1, $ctx['taskList']);
        $this->assertCount(1, $ctx['slotsToday']);
    }

    public function testInvalidDateReturnsEmpty(): void
    {
        $pdo = $this->minimalPdo();
        $ctx = ai_build_server_task_context($pdo, 'not-a-date', []);
        $this->assertSame([], $ctx);
    }
}
