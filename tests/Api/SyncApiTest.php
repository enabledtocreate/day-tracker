<?php

require_once __DIR__ . '/ApiTestCase.php';

final class SyncApiTest extends ApiTestCase {

    public function test_get_returns_revision_and_bumps_after_task_update(): void {
        $before = $this->request('GET', 'sync');
        $this->assertSame(200, $before['code']);
        $this->assertIsArray($before['body']);
        $this->assertArrayHasKey('revision', $before['body']);
        $revisionBefore = $before['body']['revision'];

        $created = $this->request('POST', 'tasks', [], ['title' => 'Sync test', 'priority' => 'low']);
        $this->assertSame(200, $created['code']);
        $taskId = (int) ($created['body']['id'] ?? 0);
        $this->assertGreaterThan(0, $taskId);

        $afterCreate = $this->request('GET', 'sync');
        $this->assertNotSame($revisionBefore, $afterCreate['body']['revision']);

        $patched = $this->request('PATCH', 'tasks', [], ['id' => $taskId, 'title' => 'Sync test renamed']);
        $this->assertSame(200, $patched['code']);

        $afterPatch = $this->request('GET', 'sync');
        $this->assertNotSame($afterCreate['body']['revision'], $afterPatch['body']['revision']);
        $this->assertArrayHasKey('tasks_updated_at', $afterPatch['body']);
    }
}
