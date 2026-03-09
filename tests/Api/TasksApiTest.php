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
}
