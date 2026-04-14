<?php
/**
 * Phase 4.4: Settings API tests.
 */
declare(strict_types=1);

require_once dirname(__DIR__) . '/ApiTestCase.php';

final class SettingsApiTest extends ApiTestCase
{
    public function testGetReturnsDefaults(): void
    {
        $res = $this->request('GET', 'settings');
        $this->assertSame(200, $res['code']);
        $b = $res['body'];
        $this->assertArrayHasKey('start_hour', $b);
        $this->assertArrayHasKey('end_hour', $b);
        $this->assertArrayHasKey('increment_value', $b);
        $this->assertArrayHasKey('increment_unit', $b);
        $this->assertContains($b['increment_unit'], ['min', 'hr']);
        $this->assertArrayHasKey('task_schedule_layout', $b);
        $this->assertContains($b['task_schedule_layout'], ['stacked', 'split']);
    }

    public function testPatchAndGetReflectsChange(): void
    {
        $this->request('PATCH', 'settings', [], [
            'start_hour' => 7,
            'end_hour' => 22,
            'increment_value' => 30,
            'increment_unit' => 'min',
        ]);
        $res = $this->request('GET', 'settings');
        $this->assertSame(200, $res['code']);
        $this->assertSame(7, (int) $res['body']['start_hour']);
        $this->assertSame(22, (int) $res['body']['end_hour']);
        $this->assertSame(30, (int) $res['body']['increment_value']);
    }

    public function testPatchTaskScheduleLayout(): void
    {
        $this->request('PATCH', 'settings', [], ['task_schedule_layout' => 'split']);
        $res = $this->request('GET', 'settings');
        $this->assertSame(200, $res['code']);
        $this->assertSame('split', $res['body']['task_schedule_layout']);
        $this->request('PATCH', 'settings', [], ['task_schedule_layout' => 'stacked']);
        $res2 = $this->request('GET', 'settings');
        $this->assertSame('stacked', $res2['body']['task_schedule_layout']);
    }
}
