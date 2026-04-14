<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once dirname(__DIR__, 2) . '/lib/ai_thread_history.php';

final class AiThreadHistoryTest extends TestCase
{
    private function aiPdoWithThread(): PDO
    {
        $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $pdo->exec('PRAGMA foreign_keys = ON');
        $pdo->exec(
            'CREATE TABLE ai_threads (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, updated_at TEXT, title TEXT)'
        );
        $pdo->exec(
            'CREATE TABLE ai_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id INTEGER NOT NULL, role TEXT NOT NULL, created_at TEXT, payload_json TEXT NOT NULL, FOREIGN KEY (thread_id) REFERENCES ai_threads(id) ON DELETE CASCADE)'
        );
        $pdo->exec("INSERT INTO ai_threads (title) VALUES ('t')");
        return $pdo;
    }

    public function testDropsTrailingUserMatchingCurrentMessage(): void
    {
        $pdo = $this->aiPdoWithThread();
        $pdo->prepare('INSERT INTO ai_messages (thread_id, role, payload_json) VALUES (1, ?, ?)')
            ->execute(['user', json_encode(['text' => 'first'])]);
        $pdo->prepare('INSERT INTO ai_messages (thread_id, role, payload_json) VALUES (1, ?, ?)')
            ->execute(['assistant', json_encode(['summary' => 'ok'])]);
        $pdo->prepare('INSERT INTO ai_messages (thread_id, role, payload_json) VALUES (1, ?, ?)')
            ->execute(['user', json_encode(['text' => 'current turn'])]);

        $hist = ai_thread_openai_history($pdo, 1, 'current turn', 20);
        $this->assertCount(2, $hist);
        $this->assertSame('user', $hist[0]['role']);
        $this->assertStringContainsString('first', $hist[0]['content']);
        $this->assertSame('assistant', $hist[1]['role']);
    }
}
