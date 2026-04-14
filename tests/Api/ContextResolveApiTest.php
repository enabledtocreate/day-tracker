<?php
/**
 * AI context_resolve: allow-list, auth, ai_enabled.
 */
declare(strict_types=1);

require_once dirname(__DIR__) . '/ApiTestCase.php';
require_once dirname(__DIR__, 2) . '/lib/db.php';

final class ContextResolveApiTest extends ApiTestCase
{
    public function testTasksListOk(): void
    {
        $res = $this->request('POST', 'ai/context_resolve', [], [
            'dataRequests' => [
                ['id' => 'dr1', 'queryId' => 'tasks.list', 'params' => []],
            ],
        ]);
        $this->assertSame(200, $res['code']);
        $this->assertIsArray($res['body']);
        $this->assertArrayHasKey('contextFragments', $res['body']);
        $this->assertCount(1, $res['body']['contextFragments']);
        $this->assertSame('tasks.list', $res['body']['contextFragments'][0]['queryId']);
        $this->assertArrayHasKey('tasks', $res['body']['contextFragments'][0]['data']);
    }

    public function testInvalidQueryIdReturns400(): void
    {
        $res = $this->request('POST', 'ai/context_resolve', [], [
            'dataRequests' => [
                ['id' => 'dr1', 'queryId' => 'not.allowed', 'params' => []],
            ],
        ]);
        $this->assertSame(400, $res['code']);
    }

    public function testAiDisabledReturns403(): void
    {
        $master = getMasterPdo();
        $master->prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('ai_enabled', '0')")->execute();
        $res = $this->request('POST', 'ai/context_resolve', [], [
            'dataRequests' => [
                ['id' => 'dr1', 'queryId' => 'tasks.list', 'params' => []],
            ],
        ]);
        $this->assertSame(403, $res['code']);
    }
}
