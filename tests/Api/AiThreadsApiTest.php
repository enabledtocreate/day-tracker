<?php
/**
 * AI threads API (*_ai.sqlite): create, append, list, get.
 */
declare(strict_types=1);

require_once dirname(__DIR__) . '/ApiTestCase.php';

final class AiThreadsApiTest extends ApiTestCase
{
    public function testCreateAppendListAndGet(): void
    {
        $c = $this->request('POST', 'ai/threads', [], ['action' => 'create', 'title' => 'Plan chat']);
        $this->assertSame(200, $c['code']);
        $this->assertIsArray($c['body']['thread'] ?? null);
        $tid = (int) $c['body']['thread']['id'];
        $this->assertGreaterThan(0, $tid);

        $a1 = $this->request('POST', 'ai/threads', [], [
            'action' => 'append',
            'thread_id' => $tid,
            'role' => 'user',
            'payload' => ['text' => 'hello', 'at' => 1000],
        ]);
        $this->assertSame(200, $a1['code']);
        $this->assertSame('user', $a1['body']['message']['role'] ?? '');

        $g = $this->request('GET', 'ai/threads', ['id' => $tid]);
        $this->assertSame(200, $g['code']);
        $this->assertCount(1, $g['body']['messages'] ?? []);
        $this->assertStringContainsString('hello', (string) ($g['body']['messages'][0]['payload_json'] ?? ''));

        $list = $this->request('GET', 'ai/threads', []);
        $this->assertSame(200, $list['code']);
        $this->assertNotEmpty($list['body']['threads'] ?? []);
    }

    public function testDeleteThread(): void
    {
        $c = $this->request('POST', 'ai/threads', [], ['action' => 'create']);
        $tid = (int) $c['body']['thread']['id'];
        $d = $this->request('DELETE', 'ai/threads', ['id' => $tid]);
        $this->assertSame(200, $d['code']);
        $this->assertSame(1, (int) ($d['body']['deleted'] ?? 0));
        $g = $this->request('GET', 'ai/threads', ['id' => $tid]);
        $this->assertSame(404, $g['code']);
    }
}
