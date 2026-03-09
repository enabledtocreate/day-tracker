<?php
/**
 * Phase 4.3: Day API tests.
 */
declare(strict_types=1);

require_once dirname(__DIR__) . '/ApiTestCase.php';

final class DayApiTest extends ApiTestCase
{
    public function testGetDateCreatesDayRecordAndReturnsSameIdOnSecondCall(): void
    {
        $date = '2025-06-15';
        $res1 = $this->request('GET', 'day', ['date' => $date]);
        $this->assertSame(200, $res1['code']);
        $this->assertArrayHasKey('id', $res1['body']);
        $this->assertSame($date, $res1['body']['date']);
        $id1 = $res1['body']['id'];

        $res2 = $this->request('GET', 'day', ['date' => $date]);
        $this->assertSame(200, $res2['code']);
        $this->assertSame($id1, $res2['body']['id']);
        $this->assertSame($date, $res2['body']['date']);
    }
}
