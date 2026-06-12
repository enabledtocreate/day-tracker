<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once dirname(__DIR__, 2) . '/lib/rrule.php';

final class RruleTest extends TestCase
{
    public function testEndDateMapsToUntil(): void
    {
        $rule = [
            'freq' => 'weekly',
            'weekDays' => [1, 2, 3, 4],
            'endDate' => '2026-05-17',
        ];
        $this->assertStringContainsString('UNTIL=20260517T235959Z', recurrenceRuleJsonToRrule($rule));
        $this->assertSame('2026-05-17', recurrenceSeriesEndDateInclusive($rule));
    }

    public function testExplicitUntilTakesPrecedenceOverEndDate(): void
    {
        $rule = [
            'freq' => 'daily',
            'until' => '2026-06-01',
            'endDate' => '2026-05-17',
        ];
        $this->assertStringContainsString('UNTIL=20260601T235959Z', recurrenceRuleJsonToRrule($rule));
    }

    public function testWeeklyByDayFromWeekDays(): void
    {
        $rule = ['freq' => 'weekly', 'weekDays' => [1, 2, 3, 4]];
        $this->assertStringContainsString('BYDAY=MO,TU,WE,TH', recurrenceRuleJsonToRrule($rule));
    }
}
