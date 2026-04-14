<?php
/**
 * Phase 4.8: Accomplished API – list by day_id or date.
 */
declare(strict_types=1);

require_once dirname(__DIR__) . '/ApiTestCase.php';

final class AccomplishedApiTest extends ApiTestCase
{
    public function testGetAccomplishedEmptyThenCompleteSlotAndList(): void
    {
        $date = '2025-10-01';
        $res = $this->request('GET', 'accomplished', ['date' => $date]);
        $this->assertSame(200, $res['code']);
        $this->assertArrayHasKey('accomplished', $res['body']);
        $this->assertSame([], $res['body']['accomplished']);

        $taskRes = $this->request('POST', 'tasks', [], ['title' => 'Accomplished task']);
        $taskId = $taskRes['body']['id'];
        $dayRes = $this->request('GET', 'day', ['date' => $date]);
        $dayId = $dayRes['body']['id'];
        $slotRes = $this->request('POST', 'slots', [], [
            'day_record_id' => $dayId,
            'task_id' => $taskId,
            'start_time' => '10:00',
            'end_time' => '11:00',
        ]);
        $this->request('PATCH', 'slots', [], ['id' => $slotRes['body']['id'], 'completed' => true]);

        $res2 = $this->request('GET', 'accomplished', ['date' => $date]);
        $this->assertSame(200, $res2['code']);
        $acc = $res2['body']['accomplished'];
        $this->assertGreaterThanOrEqual(1, count($acc));
    }

    public function testSummaryOrgAndDateFilter(): void
    {
        $date = '2025-11-20';
        $taskRes = $this->request('POST', 'tasks', [], ['title' => 'Summary cat task']);
        $taskId = $taskRes['body']['id'];
        $dayRes = $this->request('GET', 'day', ['date' => $date]);
        $dayId = $dayRes['body']['id'];
        $slotRes = $this->request('POST', 'slots', [], [
            'day_record_id' => $dayId,
            'task_id' => $taskId,
            'start_time' => '09:00',
            'end_time' => '10:30',
        ]);
        $this->request('PATCH', 'slots', [], ['id' => $slotRes['body']['id'], 'completed' => true]);

        $summary = $this->request('GET', 'accomplished', ['summary_org' => '1']);
        $this->assertSame(200, $summary['code']);
        $days = $summary['body']['days'];
        $this->assertGreaterThanOrEqual(1, count($days));
        $found = false;
        foreach ($days as $block) {
            if (($block['date'] ?? '') === $date) {
                $found = true;
                $this->assertNotEmpty($block['rows']);
                $row0 = $block['rows'][0];
                $this->assertArrayHasKey('tasks', $row0);
                $this->assertGreaterThanOrEqual(1, count($row0['tasks']));
                $t0 = $row0['tasks'][0];
                $this->assertSame($taskId, (int) $t0['task_id']);
                $this->assertArrayHasKey('links', $t0);
                $this->assertArrayHasKey('list_items', $t0);
                $this->assertArrayHasKey('tags', $t0);
                $this->assertIsArray($t0['tags']);
            }
        }
        $this->assertTrue($found, 'Expected summary day present');

        $before = $this->request('GET', 'accomplished', [
            'summary_org' => '1',
            'from_date' => '2025-01-01',
            'to_date' => '2025-06-01',
        ]);
        $this->assertSame(200, $before['code']);
        $this->assertSame([], $before['body']['days'] ?? []);
    }
}
