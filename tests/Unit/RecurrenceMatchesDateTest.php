<?php
/**
 * Phase 3.2: Unit tests for recurrenceMatchesDate (lib/recurrence.php).
 */
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once dirname(__DIR__, 2) . '/lib/recurrence.php';

final class RecurrenceMatchesDateTest extends TestCase
{
    /** @dataProvider dailyRuleProvider */
    public function testNullOrEmptyRuleMatchesAnyDate(string $date): void
    {
        $this->assertTrue(recurrenceMatchesDate(null, $date));
        $this->assertTrue(recurrenceMatchesDate([], $date));
    }

    /** @return array<string, array{string}> */
    public static function dailyRuleProvider(): array
    {
        return [
            'any date' => ['2025-06-15'],
            'sunday' => ['2025-06-08'],
            'monday' => ['2025-06-09'],
        ];
    }

    public function testFreqDailyMatchesAnyDate(): void
    {
        $this->assertTrue(recurrenceMatchesDate(['freq' => 'daily'], '2025-01-15'));
        $this->assertTrue(recurrenceMatchesDate(['freq' => 'daily'], '2025-12-31'));
    }

    public function testFreqWeeklyWeekDaysMatchesSundayAndWednesdayFailsMonday(): void
    {
        $rule = ['freq' => 'weekly', 'weekDays' => [0, 3]];
        $this->assertTrue(recurrenceMatchesDate($rule, '2025-06-08'), 'Sunday (0) should match');
        $this->assertTrue(recurrenceMatchesDate($rule, '2025-06-11'), 'Wednesday (3) should match');
        $this->assertFalse(recurrenceMatchesDate($rule, '2025-06-09'), 'Monday (1) should not match');
    }

    public function testFreqMonthlyMonthDaysMatchesFirstAndFifteenth(): void
    {
        $rule = ['freq' => 'monthly', 'monthDays' => [1, 15]];
        $this->assertTrue(recurrenceMatchesDate($rule, '2025-07-01'));
        $this->assertTrue(recurrenceMatchesDate($rule, '2025-07-15'));
        $this->assertFalse(recurrenceMatchesDate($rule, '2025-07-02'));
        $this->assertFalse(recurrenceMatchesDate($rule, '2025-07-14'));
    }

    public function testFreqMonthlyLastDayOfMonthMatchesLastDayOnly(): void
    {
        $rule = ['freq' => 'monthly', 'lastDayOfMonth' => true];
        $this->assertTrue(recurrenceMatchesDate($rule, '2025-01-31'));
        $this->assertTrue(recurrenceMatchesDate($rule, '2025-02-28'));
        $this->assertTrue(recurrenceMatchesDate($rule, '2024-02-29'));
        $this->assertFalse(recurrenceMatchesDate($rule, '2025-01-30'));
        $this->assertFalse(recurrenceMatchesDate($rule, '2025-02-27'));
    }

    public function testFreqYearlyReturnsTrue(): void
    {
        $this->assertTrue(recurrenceMatchesDate(['freq' => 'yearly'], '2025-06-15'));
    }

    public function testInvalidDateReturnsFalse(): void
    {
        $this->assertFalse(recurrenceMatchesDate(null, 'not-a-date'));
        $this->assertFalse(recurrenceMatchesDate([], '2025-13-01'));
        $this->assertFalse(recurrenceMatchesDate(['freq' => 'daily'], ''));
    }
}
