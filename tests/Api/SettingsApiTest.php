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

    public function testPatchPriorityThemeJsonIsStoredAndSanitized(): void
    {
        $raw = json_encode([
            'commitment' => ['label' => 'Focus', 'icon' => '★', 'color' => '#f00'],
            'high' => ['label' => 'High', 'icon' => '↑'],
            'medium' => ['label' => 'Medium', 'icon' => '●'],
            'low' => ['label' => 'Low', 'icon' => '↓', 'color' => 'bad'],
        ]);
        $this->request('PATCH', 'settings', [], ['priority_theme_json' => $raw]);
        $res = $this->request('GET', 'settings');
        $this->assertSame(200, $res['code']);
        $this->assertArrayHasKey('priority_theme_json', $res['body']);
        $stored = json_decode((string) $res['body']['priority_theme_json'], true);
        $this->assertIsArray($stored);
        $this->assertSame('Focus', $stored['commitment']['label']);
        $this->assertSame('#f00', $stored['commitment']['color']);
        $this->assertArrayNotHasKey('color', $stored['low']);
    }

    public function testPatchBucketLabelsJson(): void
    {
        $raw = json_encode(['unassigned' => 'Inbox', 'pending' => 'Backlog']);
        $this->request('PATCH', 'settings', [], ['bucket_labels_json' => $raw]);
        $res = $this->request('GET', 'settings');
        $this->assertSame(200, $res['code']);
        $this->assertArrayHasKey('bucket_labels_json', $res['body']);
        $stored = json_decode((string) $res['body']['bucket_labels_json'], true);
        $this->assertSame('Inbox', $stored['unassigned']);
        $this->assertSame('Backlog', $stored['pending']);
    }

    public function testPatchDueAutoPriorityTarget(): void
    {
        $this->request('PATCH', 'settings', [], ['due_auto_priority_target' => 'medium']);
        $res = $this->request('GET', 'settings');
        $this->assertSame(200, $res['code']);
        $this->assertSame('medium', $res['body']['due_auto_priority_target']);
    }

    public function testPatchPriorityLayoutJsonCustom(): void
    {
        $raw = json_encode([
            'version' => 2,
            'mode' => 'custom',
            'priorities' => [
                ['id' => 'p1', 'label' => 'One', 'icon' => '1'],
                ['id' => 'p2', 'label' => 'Two', 'icon' => '2', 'color' => '#abc'],
            ],
        ]);
        $this->request('PATCH', 'settings', [], ['priority_layout_json' => $raw]);
        $res = $this->request('GET', 'settings');
        $this->assertSame(200, $res['code']);
        $this->assertArrayHasKey('priority_layout_json', $res['body']);
        $stored = json_decode((string) $res['body']['priority_layout_json'], true);
        $this->assertSame('custom', $stored['mode']);
        $this->assertCount(2, $stored['priorities']);
        $this->assertSame('p1', $stored['priorities'][0]['id']);
        $this->assertSame('#abc', $stored['priorities'][1]['color']);
    }

    public function testPatchBucketLayoutJsonCustom(): void
    {
        $raw = json_encode([
            'version' => 2,
            'mode' => 'custom',
            'buckets' => [
                ['id' => 'inbox', 'label' => 'Inbox'],
                ['id' => 'later', 'label' => 'Later'],
            ],
        ]);
        $this->request('PATCH', 'settings', [], ['bucket_layout_json' => $raw]);
        $res = $this->request('GET', 'settings');
        $this->assertSame(200, $res['code']);
        $this->assertArrayHasKey('bucket_layout_json', $res['body']);
        $stored = json_decode((string) $res['body']['bucket_layout_json'], true);
        $this->assertSame('inbox', $stored['buckets'][0]['id']);
    }

    public function testClearOptionalSettingsRemovesKeys(): void
    {
        $this->request('PATCH', 'settings', [], [
            'priority_theme_json' => json_encode([
                'commitment' => ['label' => 'C', 'icon' => '★'],
                'high' => ['label' => 'H', 'icon' => '↑'],
                'medium' => ['label' => 'M', 'icon' => '●'],
                'low' => ['label' => 'L', 'icon' => '↓'],
            ]),
            'bucket_labels_json' => json_encode(['unassigned' => 'U', 'pending' => 'P']),
            'due_auto_priority_target' => 'commitment',
        ]);
        $this->request('PATCH', 'settings', [], [
            'priority_theme_json' => '',
            'bucket_labels_json' => '',
            'due_auto_priority_target' => null,
        ]);
        $res = $this->request('GET', 'settings');
        $this->assertSame(200, $res['code']);
        $this->assertArrayNotHasKey('priority_theme_json', $res['body']);
        $this->assertArrayNotHasKey('bucket_labels_json', $res['body']);
        $this->assertArrayNotHasKey('due_auto_priority_target', $res['body']);
    }
}
