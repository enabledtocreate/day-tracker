<?php
/**
 * §5.15: Completion on an iCal row survives delete/replace sync (persistent marks + merge on insert).
 */
declare(strict_types=1);

require_once dirname(__DIR__) . '/ApiTestCase.php';
require_once dirname(__DIR__, 2) . '/lib/ical_completion.php';

final class IcalCompletionPersistenceApiTest extends ApiTestCase
{
    /**
     * Mirror merge/delete/insert body in api/ical_events.php::icalEventsSyncSubscription (no network).
     *
     * @param list<array{uid: string, start: string, title?: string, end?: string, allDay?: bool, event_type?: string}> $parsedEvents
     */
    private function simulateFeedResync(PDO $pdo, int $subId, string $todayUtc, array $parsedEvents): void
    {
        $existingCompletedByKey = [];
        $stmt = $pdo->prepare('SELECT uid, start_iso, user_completed FROM ical_feed_events WHERE subscription_id = ? AND date(start_iso) >= ?');
        $stmt->execute([$subId, $todayUtc]);
        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $key = icalCompletionKey((string) ($row['uid'] ?? ''), (string) ($row['start_iso'] ?? ''));
            $existingCompletedByKey[$key] = ((int) ($row['user_completed'] ?? 0) === 1) ? 1 : 0;
        }
        $marksMap = icalLoadCompletionMarks($pdo, $subId);
        $existingCompletedByKey = icalMergeCompletionWithMarks($existingCompletedByKey, $marksMap);

        $del = $pdo->prepare('DELETE FROM ical_feed_events WHERE subscription_id = ? AND date(start_iso) >= ?');
        $del->execute([$subId, $todayUtc]);

        $insert = $pdo->prepare(
            'INSERT INTO ical_feed_events (subscription_id, uid, title, start_iso, end_iso, all_day, user_completed, event_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        );
        foreach ($parsedEvents as $ev) {
            $uid = (string) ($ev['uid'] ?? '');
            $start = (string) ($ev['start'] ?? '');
            $uc = icalGetUserCompletedFromMap($existingCompletedByKey, $uid, $start);
            $insert->execute([
                $subId,
                $uid,
                $ev['title'] ?? 'Event',
                $start,
                $ev['end'] ?? $start,
                !empty($ev['allDay']) ? 1 : 0,
                $uc,
                $ev['event_type'] ?? 'event',
            ]);
            if ($uc === 1) {
                icalUpsertCompletionMark($pdo, $subId, $uid, $start, 1);
            }
        }
    }

    private function openUserPdo(): PDO
    {
        $path = $this->dataDir . DIRECTORY_SEPARATOR . $this->testUser['db_name'];

        return new PDO('sqlite:' . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    }

    public function testCompletionSurvivesSimulatedFeedRowReplace(): void
    {
        $pdo = $this->openUserPdo();
        $pdo->exec("INSERT INTO ical_subscriptions (feed_url, last_synced_at) VALUES ('https://example.invalid/calendar.ics', datetime('now'))");
        $subId = (int) $pdo->lastInsertId();

        $todayUtc = gmdate('Y-m-d');
        // Must fall in sync window date(start_iso) >= today (UTC) like production sync.
        $startIso = gmdate('Y-m-d', strtotime($todayUtc . ' +14 days')) . 'T15:00:00Z';
        $uid = 'persist-test-uid@ical';

        $ins = $pdo->prepare(
            'INSERT INTO ical_feed_events (subscription_id, uid, title, start_iso, end_iso, all_day, user_completed, event_type)
             VALUES (?, ?, ?, ?, ?, 0, 0, ?)'
        );
        $ins->execute([$subId, $uid, 'Before sync', $startIso, $startIso, 'event']);
        $oldId = (int) $pdo->lastInsertId();

        $patch = $this->request('PATCH', 'ical_events', [], ['id' => $oldId, 'user_completed' => true]);
        $this->assertSame(200, $patch['code']);
        $this->assertSame(['ok' => true], $patch['body']);

        $mark = $pdo->prepare('SELECT user_completed FROM ical_completion_marks WHERE subscription_id = ? AND uid = ? AND start_iso = ?');
        $mark->execute([$subId, $uid, $startIso]);
        $this->assertSame(1, (int) $mark->fetchColumn(), 'completion mark should exist after PATCH');

        // Full replace of future rows: new SQLite row id, same uid/start from "feed".
        $this->simulateFeedResync($pdo, $subId, $todayUtc, [
            [
                'uid' => $uid,
                'start' => $startIso,
                'title' => 'After sync',
                'end' => $startIso,
                'event_type' => 'event',
            ],
        ]);

        $row = $pdo->prepare('SELECT id, user_completed, title FROM ical_feed_events WHERE subscription_id = ? AND uid = ? AND start_iso = ?');
        $row->execute([$subId, $uid, $startIso]);
        $after = $row->fetch(PDO::FETCH_ASSOC);
        $this->assertNotFalse($after);
        $this->assertNotSame($oldId, (int) $after['id'], 'row id should change after delete/insert');
        $this->assertSame(1, (int) $after['user_completed'], 'user_completed must persist via marks merge');
        $this->assertSame('After sync', $after['title'], 'new title from feed should be stored');
    }

    public function testPastFeedRowsAreNotTouchedOnResync(): void
    {
        $pdo = $this->openUserPdo();
        $pdo->exec("INSERT INTO ical_subscriptions (feed_url, last_synced_at) VALUES ('https://example.invalid/calendar.ics', datetime('now'))");
        $subId = (int) $pdo->lastInsertId();

        $todayUtc = gmdate('Y-m-d');
        $pastStart = gmdate('Y-m-d', strtotime($todayUtc . ' -7 days')) . 'T10:00:00Z';
        $futureStart = gmdate('Y-m-d', strtotime($todayUtc . ' +7 days')) . 'T10:00:00Z';

        $ins = $pdo->prepare(
            'INSERT INTO ical_feed_events (subscription_id, uid, title, start_iso, end_iso, all_day, user_completed, event_type)
             VALUES (?, ?, ?, ?, ?, 0, 0, ?)'
        );
        $ins->execute([$subId, 'past-uid@ical', 'Past unchanged', $pastStart, $pastStart, 'event']);
        $pastId = (int) $pdo->lastInsertId();
        $ins->execute([$subId, 'future-uid@ical', 'Future old title', $futureStart, $futureStart, 'event']);

        $this->simulateFeedResync($pdo, $subId, $todayUtc, [
            [
                'uid' => 'future-uid@ical',
                'start' => $futureStart,
                'title' => 'Future new title',
                'end' => $futureStart,
                'event_type' => 'event',
            ],
        ]);

        $past = $pdo->prepare('SELECT id, title FROM ical_feed_events WHERE id = ?');
        $past->execute([$pastId]);
        $pastRow = $past->fetch(PDO::FETCH_ASSOC);
        $this->assertNotFalse($pastRow);
        $this->assertSame('Past unchanged', $pastRow['title'], 'past rows must not be deleted or updated on sync');

        $future = $pdo->prepare('SELECT title FROM ical_feed_events WHERE subscription_id = ? AND uid = ?');
        $future->execute([$subId, 'future-uid@ical']);
        $this->assertSame('Future new title', $future->fetchColumn());
    }
}
