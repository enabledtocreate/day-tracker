<?php
/**
 * Phase 4.7: Links API – CRUD for task links.
 */
declare(strict_types=1);

require_once dirname(__DIR__) . '/ApiTestCase.php';

final class LinksApiTest extends ApiTestCase
{
    public function testGetEmptyThenPostAndListAndDelete(): void
    {
        $taskRes = $this->request('POST', 'tasks', [], ['title' => 'Task with link']);
        $taskId = $taskRes['body']['id'];
        $res = $this->request('GET', 'links', ['task_id' => $taskId]);
        $this->assertSame(200, $res['code']);
        $this->assertSame([], $res['body']['links']);

        $post = $this->request('POST', 'links', [], [
            'task_id' => $taskId,
            'url' => 'https://example.com/doc',
            'description' => 'Doc link',
        ]);
        $this->assertSame(200, $post['code']);
        $this->assertArrayHasKey('id', $post['body']);
        $linkId = $post['body']['id'];

        $res2 = $this->request('GET', 'links', ['task_id' => $taskId]);
        $this->assertCount(1, $res2['body']['links']);
        $this->assertSame('https://example.com/doc', $res2['body']['links'][0]['url']);

        $this->request('DELETE', 'links', ['id' => $linkId]);
        $res3 = $this->request('GET', 'links', ['task_id' => $taskId]);
        $this->assertCount(0, $res3['body']['links']);
    }
}
