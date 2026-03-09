<?php
/**
 * Phase 4.7: Task list items API – CRUD for task_list_items.
 */
declare(strict_types=1);

require_once dirname(__DIR__) . '/ApiTestCase.php';

final class TaskListItemsApiTest extends ApiTestCase
{
    public function testGetEmptyThenPostAndListAndPatchAndDelete(): void
    {
        $taskRes = $this->request('POST', 'tasks', [], ['title' => 'Checklist task', 'list_style' => 'checklist']);
        $taskId = $taskRes['body']['id'];
        $res = $this->request('GET', 'task_list_items', ['task_id' => $taskId]);
        $this->assertSame(200, $res['code']);
        $this->assertSame([], $res['body']['items']);

        $post = $this->request('POST', 'task_list_items', [], [
            'task_id' => $taskId,
            'content' => 'First item',
            'order_index' => 0,
        ]);
        $this->assertSame(200, $post['code']);
        $id = $post['body']['id'];

        $res2 = $this->request('GET', 'task_list_items', ['task_id' => $taskId]);
        $this->assertCount(1, $res2['body']['items']);
        $this->assertSame('First item', $res2['body']['items'][0]['content']);

        $this->request('PATCH', 'task_list_items', [], ['id' => $id, 'content' => 'Updated item']);
        $res3 = $this->request('GET', 'task_list_items', ['task_id' => $taskId]);
        $this->assertSame('Updated item', $res3['body']['items'][0]['content']);

        $this->request('DELETE', 'task_list_items', ['id' => $id]);
        $res4 = $this->request('GET', 'task_list_items', ['task_id' => $taskId]);
        $this->assertCount(0, $res4['body']['items']);
    }
}
