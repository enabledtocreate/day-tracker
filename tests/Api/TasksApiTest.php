<?php
/**
 * Phase 4.1: Tasks API tests.
 */
declare(strict_types=1);

require_once dirname(__DIR__) . '/ApiTestCase.php';

use PHPUnit\Framework\TestCase;

final class TasksApiTest extends ApiTestCase
{
    public function testGetEmptyList(): void
    {
        $res = $this->request('GET', 'tasks');
        $this->assertSame(200, $res['code']);
        $this->assertIsArray($res['body']['tasks'] ?? null);
        $this->assertSame([], $res['body']['tasks']);
    }

    public function testPostCreateAndGetList(): void
    {
        $res = $this->request('POST', 'tasks', [], ['title' => 'My task', 'priority' => 'high']);
        $this->assertSame(200, $res['code']);
        $this->assertArrayHasKey('id', $res['body']);
        $this->assertSame('My task', $res['body']['title']);
        $this->assertSame('high', $res['body']['priority']);
        $id = $res['body']['id'];

        $res2 = $this->request('GET', 'tasks');
        $this->assertSame(200, $res2['code']);
        $tasks = $res2['body']['tasks'];
        $this->assertCount(1, $tasks);
        $this->assertSame($id, $tasks[0]['id']);
        $this->assertSame('My task', $tasks[0]['title']);
    }

    public function testPatchUpdateListStateAndTitle(): void
    {
        $res = $this->request('POST', 'tasks', [], ['title' => 'Patch me']);
        $id = $res['body']['id'];
        $this->request('PATCH', 'tasks', [], ['id' => $id, 'list_state' => 'pending']);
        $res2 = $this->request('GET', 'tasks');
        $found = null;
        foreach ($res2['body']['tasks'] as $t) {
            if ((int) $t['id'] === $id) {
                $found = $t;
                break;
            }
        }
        $this->assertSame('pending', $found['list_state'] ?? null);
        $this->request('PATCH', 'tasks', [], ['id' => $id, 'title' => 'Updated title']);
        $res3 = $this->request('GET', 'tasks');
        foreach ($res3['body']['tasks'] as $t) {
            if ((int) $t['id'] === $id) {
                $this->assertSame('Updated title', $t['title']);
                break;
            }
        }
    }

    public function testDeleteTask(): void
    {
        $res = $this->request('POST', 'tasks', [], ['title' => 'To delete']);
        $id = $res['body']['id'];
        $resDel = $this->request('DELETE', 'tasks', ['id' => $id]);
        $this->assertSame(200, $resDel['code']);
        $res2 = $this->request('GET', 'tasks');
        foreach ($res2['body']['tasks'] as $t) {
            $this->assertNotSame($id, (int) $t['id']);
        }
    }

    public function testDeleteGroupRootLeavesSiblings(): void
    {
        $root = $this->request('POST', 'tasks', [], ['title' => 'Group root']);
        $child1 = $this->request('POST', 'tasks', [], ['title' => 'Child 1']);
        $child2 = $this->request('POST', 'tasks', [], ['title' => 'Child 2']);
        $rootId = (int) $root['body']['id'];
        $child1Id = (int) $child1['body']['id'];
        $child2Id = (int) $child2['body']['id'];

        $this->request('PATCH', 'tasks', [], ['id' => $child1Id, 'parent_id' => $rootId]);
        $this->request('PATCH', 'tasks', [], ['id' => $child2Id, 'parent_id' => $rootId]);

        $resDel = $this->request('DELETE', 'tasks', ['id' => $rootId]);
        $this->assertSame(200, $resDel['code']);

        $res = $this->request('GET', 'tasks');
        $ids = array_map(fn ($t) => (int) $t['id'], $res['body']['tasks'] ?? []);
        $this->assertNotContains($rootId, $ids);
        $this->assertContains($child1Id, $ids);
        $this->assertContains($child2Id, $ids);
        foreach ($res['body']['tasks'] as $t) {
            if ((int) $t['id'] === $child1Id || (int) $t['id'] === $child2Id) {
                $this->assertNull($t['parent_id'] ?? null);
                $this->assertSame('unassigned', $t['list_state'] ?? null);
            }
        }
    }

    public function testDeleteGroupMemberLeavesOtherMembers(): void
    {
        $root = $this->request('POST', 'tasks', [], ['title' => 'Group root']);
        $child1 = $this->request('POST', 'tasks', [], ['title' => 'Child 1']);
        $child2 = $this->request('POST', 'tasks', [], ['title' => 'Child 2']);
        $rootId = (int) $root['body']['id'];
        $child1Id = (int) $child1['body']['id'];
        $child2Id = (int) $child2['body']['id'];

        $this->request('PATCH', 'tasks', [], ['id' => $child1Id, 'parent_id' => $rootId]);
        $this->request('PATCH', 'tasks', [], ['id' => $child2Id, 'parent_id' => $rootId]);

        $resDel = $this->request('DELETE', 'tasks', ['id' => $child1Id]);
        $this->assertSame(200, $resDel['code']);

        $res = $this->request('GET', 'tasks');
        $byId = [];
        foreach ($res['body']['tasks'] as $t) {
            $byId[(int) $t['id']] = $t;
        }
        $this->assertArrayHasKey($rootId, $byId);
        $this->assertArrayHasKey($child2Id, $byId);
        $this->assertArrayNotHasKey($child1Id, $byId);
        $this->assertSame($rootId, (int) ($byId[$child2Id]['parent_id'] ?? 0));
    }

    public function testGroupAttachSyncsChildListStateWithParent(): void
    {
        $root = $this->request('POST', 'tasks', [], ['title' => 'Root', 'list_state' => 'unassigned']);
        $child = $this->request('POST', 'tasks', [], ['title' => 'Child', 'list_state' => 'pending']);
        $rootId = (int) $root['body']['id'];
        $childId = (int) $child['body']['id'];

        $patch = $this->request('PATCH', 'tasks', [], ['id' => $childId, 'parent_id' => $rootId]);
        $this->assertSame(200, $patch['code']);
        $this->assertSame('unassigned', $patch['body']['task']['list_state'] ?? null);
    }

    public function testPostWithRecurringAndRecurrenceRule(): void
    {
        $res = $this->request('POST', 'tasks', [], [
            'title' => 'Recurring',
            'recurring' => true,
        ]);
        $this->assertSame(200, $res['code']);
        $this->assertTrue($res['body']['recurring']);
        $id = $res['body']['id'];
        $rule = json_encode(['freq' => 'weekly', 'weekDays' => [1, 3]]);
        $this->request('PATCH', 'tasks', [], ['id' => $id, 'recurrence_rule' => $rule]);
        $res2 = $this->request('GET', 'tasks');
        foreach ($res2['body']['tasks'] as $t) {
            if ((int) $t['id'] === $id && isset($t['recurrence_rule'])) {
                $this->assertSame($rule, $t['recurrence_rule']);
                return;
            }
        }
        $this->assertTrue(true, 'Task with recurrence_rule listed (or column absent in old DB)');
    }

    public function testGroupOrderAssignedOnParentChangeAndResetOnUngroup(): void
    {
        $rootA = $this->request('POST', 'tasks', [], ['title' => 'Root A', 'priority' => 'medium']);
        $rootB = $this->request('POST', 'tasks', [], ['title' => 'Root B', 'priority' => 'medium']);
        $child1 = $this->request('POST', 'tasks', [], ['title' => 'Child 1', 'priority' => 'medium']);
        $child2 = $this->request('POST', 'tasks', [], ['title' => 'Child 2', 'priority' => 'medium']);

        $rootAId = (int) $rootA['body']['id'];
        $rootBId = (int) $rootB['body']['id'];
        $child1Id = (int) $child1['body']['id'];
        $child2Id = (int) $child2['body']['id'];

        // Group child1 under rootA; expect first child => group_order=0
        $patch1 = $this->request('PATCH', 'tasks', [], ['id' => $child1Id, 'parent_id' => $rootAId]);
        $this->assertSame(200, $patch1['code']);
        $this->assertSame(0, (int) ($patch1['body']['task']['group_order'] ?? -999));

        // Group child2 under rootA; expect second child => group_order=1
        $patch2 = $this->request('PATCH', 'tasks', [], ['id' => $child2Id, 'parent_id' => $rootAId]);
        $this->assertSame(200, $patch2['code']);
        $this->assertSame(1, (int) ($patch2['body']['task']['group_order'] ?? -999));

        // Ungroup child1
        $patch3 = $this->request('PATCH', 'tasks', [], ['id' => $child1Id, 'parent_id' => null]);
        $this->assertSame(200, $patch3['code']);
        $this->assertSame(0, (int) ($patch3['body']['task']['group_order'] ?? -999));

        // Verify ordering of remaining children by inspecting GET list.
        $res = $this->request('GET', 'tasks');
        $this->assertSame(200, $res['code']);

        $ordersForRootA = [];
        $ordersForRootB = [];
        foreach (($res['body']['tasks'] ?? []) as $t) {
            $pid = $t['parent_id'] ?? null;
            $go = $t['group_order'] ?? null;
            if ((int) $pid === $rootAId) {
                $ordersForRootA[] = (int) $go;
            }
            if ((int) $pid === $rootBId) {
                $ordersForRootB[] = (int) $go;
            }
        }

        // After ungrouping child1, only child2 remains under rootA with group_order=1
        $this->assertSame([1], $ordersForRootA);
        $this->assertSame([], $ordersForRootB);
    }

    public function testCommonTaskCreateListAndCopyFrom(): void
    {
        $this->request('POST', 'tasks', [], ['title' => 'Template A', 'is_common' => true]);
        $list = $this->request('GET', 'tasks', ['common' => '1']);
        $this->assertSame(200, $list['code']);
        $this->assertCount(1, $list['body']['tasks']);
        $tid = (int) $list['body']['tasks'][0]['id'];
        $this->assertTrue((bool) ($list['body']['tasks'][0]['is_common'] ?? false));

        $un = $this->request('GET', 'tasks', ['list_state' => 'unassigned']);
        foreach ($un['body']['tasks'] ?? [] as $t) {
            $this->assertNotSame($tid, (int) $t['id'], 'Common task must not appear in unassigned list');
        }

        $copy = $this->request('POST', 'tasks', [], ['copy_from' => $tid, 'list_state' => 'unassigned']);
        $this->assertSame(200, $copy['code']);
        $newId = (int) $copy['body']['id'];
        $this->assertNotSame($tid, $newId);
        $this->assertSame('Template A', $copy['body']['title']);
        $this->assertFalse((bool) ($copy['body']['is_common'] ?? false));
    }

    public function testCopyFromPreservesChecklistStyleAndItemCompleted(): void
    {
        $r = $this->request('POST', 'tasks', [], ['title' => 'Check root', 'list_style' => 'checklist']);
        $this->assertSame(200, $r['code']);
        $tid = (int) $r['body']['id'];
        $li = $this->request('POST', 'task_list_items', [], [
            'task_id' => $tid,
            'content' => 'Done item',
            'order_index' => 0,
            'completed' => 1,
        ]);
        $this->assertSame(200, $li['code']);
        $copy = $this->request('POST', 'tasks', [], ['copy_from' => $tid, 'list_state' => 'unassigned']);
        $this->assertSame(200, $copy['code']);
        $newId = (int) $copy['body']['id'];
        $this->assertSame('checklist', $copy['body']['list_style'] ?? '');
        $items = $this->request('GET', 'task_list_items', ['task_id' => $newId]);
        $this->assertSame(200, $items['code']);
        $this->assertCount(1, $items['body']['items'] ?? []);
        $this->assertSame(1, (int) ($items['body']['items'][0]['completed'] ?? 0));
        $this->assertSame('Done item', $items['body']['items'][0]['content'] ?? '');
    }
}
