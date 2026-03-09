<?php
/**
 * Phase 4.6: Rollover API – remove incomplete slots for past days.
 */
declare(strict_types=1);

require_once dirname(__DIR__) . '/ApiTestCase.php';

final class RolloverApiTest extends ApiTestCase
{
    public function testRolloverRemovesIncompleteSlotsForPastDay(): void
    {
        $taskRes = $this->request('POST', 'tasks', [], ['title' => 'Past task']);
        $taskId = $taskRes['body']['id'];
        $pastDate = '2020-01-01';
        $dayRes = $this->request('GET', 'day', ['date' => $pastDate]);
        $dayId = $dayRes['body']['id'];
        $this->request('POST', 'slots', [], [
            'day_record_id' => $dayId,
            'task_id' => $taskId,
            'start_time' => '09:00',
            'end_time' => '10:00',
        ]);
        $slotsBefore = $this->request('GET', 'slots', ['day_id' => $dayId]);
        $this->assertCount(1, $slotsBefore['body']['slots']);

        $this->request('POST', 'rollover', ['date' => '2020-01-02']);
        $slotsAfter = $this->request('GET', 'slots', ['day_id' => $dayId]);
        $this->assertCount(0, $slotsAfter['body']['slots']);
    }
}
