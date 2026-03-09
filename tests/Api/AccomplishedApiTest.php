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
}
