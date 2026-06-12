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



    public function testRolloverKeepsIncompleteGroupMembersGrouped(): void

    {

        $root = $this->request('POST', 'tasks', [], ['title' => 'Root', 'list_state' => 'unassigned']);

        $child = $this->request('POST', 'tasks', [], ['title' => 'Child', 'list_state' => 'unassigned']);

        $rootId = (int) $root['body']['id'];

        $childId = (int) $child['body']['id'];

        $this->request('PATCH', 'tasks', [], ['id' => $childId, 'parent_id' => $rootId]);



        $pastDate = '2020-01-01';

        $dayRes = $this->request('GET', 'day', ['date' => $pastDate]);

        $dayId = $dayRes['body']['id'];

        $this->request('POST', 'slots', [], [

            'day_record_id' => $dayId,

            'task_id' => $rootId,

            'start_time' => '09:00',

            'end_time' => '10:00',

            'completed' => 1,

        ]);

        $this->request('POST', 'slots', [], [

            'day_record_id' => $dayId,

            'task_id' => $childId,

            'start_time' => '09:00',

            'end_time' => '10:00',

            'completed' => 0,

        ]);



        $this->request('POST', 'rollover', ['date' => '2020-01-02']);



        $childAfter = $this->request('GET', 'tasks', ['list_state' => 'unassigned']);

        $childRow = null;

        foreach ($childAfter['body']['tasks'] as $t) {

            if ((int) $t['id'] === $childId) {

                $childRow = $t;

                break;

            }

        }

        $this->assertNotNull($childRow);

        $this->assertSame($rootId, (int) $childRow['parent_id']);

    }



    public function testRolloverUngroupsCompletedPastDayGroupMembers(): void

    {

        $root = $this->request('POST', 'tasks', [], ['title' => 'Root', 'list_state' => 'unassigned']);

        $completedChild = $this->request('POST', 'tasks', [], ['title' => 'Done child', 'list_state' => 'unassigned']);

        $incompleteChild = $this->request('POST', 'tasks', [], ['title' => 'Open child', 'list_state' => 'unassigned']);

        $rootId = (int) $root['body']['id'];

        $completedChildId = (int) $completedChild['body']['id'];

        $incompleteChildId = (int) $incompleteChild['body']['id'];

        $this->request('PATCH', 'tasks', [], ['id' => $completedChildId, 'parent_id' => $rootId]);

        $this->request('PATCH', 'tasks', [], ['id' => $incompleteChildId, 'parent_id' => $rootId]);



        $pastDate = '2020-01-01';

        $dayRes = $this->request('GET', 'day', ['date' => $pastDate]);

        $dayId = $dayRes['body']['id'];

        $this->request('POST', 'slots', [], [

            'day_record_id' => $dayId,

            'task_id' => $completedChildId,

            'start_time' => '09:00',

            'end_time' => '10:00',

            'completed' => 1,

        ]);

        $this->request('POST', 'slots', [], [

            'day_record_id' => $dayId,

            'task_id' => $incompleteChildId,

            'start_time' => '10:00',

            'end_time' => '11:00',

            'completed' => 0,

        ]);



        $this->request('POST', 'rollover', ['date' => '2020-01-02']);



        $tasksAfter = $this->request('GET', 'tasks', ['list_state' => 'unassigned']);

        $byId = [];

        foreach ($tasksAfter['body']['tasks'] as $t) {

            $byId[(int) $t['id']] = $t;

        }

        $this->assertNull($byId[$completedChildId]['parent_id'] ?? null);

        $this->assertSame($rootId, (int) $byId[$incompleteChildId]['parent_id']);

    }

}

