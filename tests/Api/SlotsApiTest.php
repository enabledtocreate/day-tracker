<?php
/**
 * Phase 4.2: Slots API tests.
 */
declare(strict_types=1);

require_once dirname(__DIR__) . '/ApiTestCase.php';

final class SlotsApiTest extends ApiTestCase
{
    public function testGetByDayIdEmpty(): void
    {
        $dayRes = $this->request('GET', 'day', ['date' => '2025-07-01']);
        $dayId = $dayRes['body']['id'];
        $res = $this->request('GET', 'slots', ['day_id' => $dayId]);
        $this->assertSame(200, $res['code']);
        $this->assertSame([], $res['body']['slots'] ?? []);
    }

    public function testPostCreateSlotAndGetByDayId(): void
    {
        $taskRes = $this->request('POST', 'tasks', [], ['title' => 'Slot task']);
        $taskId = $taskRes['body']['id'];
        $dayRes = $this->request('GET', 'day', ['date' => '2025-07-02']);
        $dayId = $dayRes['body']['id'];
        $res = $this->request('POST', 'slots', [], [
            'day_record_id' => $dayId,
            'task_id' => $taskId,
            'start_time' => '09:00',
            'end_time' => '10:00',
        ]);
        $this->assertSame(200, $res['code']);
        $this->assertArrayHasKey('id', $res['body']);
        $slotId = $res['body']['id'];
        $get = $this->request('GET', 'slots', ['day_id' => $dayId]);
        $this->assertSame(200, $get['code']);
        $slots = $get['body']['slots'];
        $this->assertCount(1, $slots);
        $this->assertSame($slotId, $slots[0]['id']);
    }

    public function testGetByFromDateToDate(): void
    {
        $taskRes = $this->request('POST', 'tasks', [], ['title' => 'Range query task']);
        $taskId = $taskRes['body']['id'];
        $dayRes = $this->request('GET', 'day', ['date' => '2025-08-01']);
        $dayId = $dayRes['body']['id'];
        $this->request('POST', 'slots', [], [
            'day_record_id' => $dayId,
            'task_id' => $taskId,
            'start_time' => '09:00',
            'end_time' => '10:00',
        ]);
        $res = $this->request('GET', 'slots', ['from_date' => '2025-08-01', 'to_date' => '2025-08-02']);
        $this->assertSame(200, $res['code']);
        $this->assertArrayHasKey('byDate', $res['body']);
        $this->assertArrayHasKey('2025-08-01', $res['body']['byDate']);
        $this->assertNotEmpty($res['body']['byDate']['2025-08-01']);
    }

    public function testPatchCompleteAndDelete(): void
    {
        $taskRes = $this->request('POST', 'tasks', [], ['title' => 'Patch slot task']);
        $taskId = $taskRes['body']['id'];
        $dayRes = $this->request('GET', 'day', ['date' => '2025-09-01']);
        $dayId = $dayRes['body']['id'];
        $post = $this->request('POST', 'slots', [], [
            'day_record_id' => $dayId,
            'task_id' => $taskId,
        ]);
        $slotId = $post['body']['id'];
        $this->request('PATCH', 'slots', [], ['id' => $slotId, 'completed' => true]);
        $get = $this->request('GET', 'slots', ['day_id' => $dayId]);
        $found = null;
        foreach ($get['body']['slots'] as $s) {
            if ((int) $s['id'] === $slotId) {
                $found = $s;
                break;
            }
        }
        $this->assertSame(1, (int) ($found['completed'] ?? 0));
        $this->request('DELETE', 'slots', ['id' => $slotId]);
        $get2 = $this->request('GET', 'slots', ['day_id' => $dayId]);
        $this->assertSame([], $get2['body']['slots']);
    }
}
