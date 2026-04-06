<?php
/**
 * Unit tests for iCal completion keying.
 */
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once dirname(__DIR__, 2) . '/lib/ical_completion.php';

final class IcalCompletionTest extends TestCase
{
    public function testCompletionKeyDistinguishesOccurrences(): void
    {
        $uid = 'event@test';
        $k1 = icalCompletionKey($uid, '2025-06-15T10:00:00Z');
        $k2 = icalCompletionKey($uid, '2025-06-15T11:00:00Z');

        $this->assertNotSame($k1, $k2);
    }

    public function testGetUserCompletedFromMapDefaultsToZero(): void
    {
        $completedByKey = [];
        $this->assertSame(0, icalGetUserCompletedFromMap($completedByKey, 'u@test', '2025-06-15T10:00:00Z'));
    }

    public function testGetUserCompletedFromMapReturnsOneWhenPresent(): void
    {
        $uid = 'u@test';
        $start = '2025-06-15T10:00:00Z';
        $key = icalCompletionKey($uid, $start);
        $completedByKey = [$key => 1];

        $this->assertSame(1, icalGetUserCompletedFromMap($completedByKey, $uid, $start));
    }

    public function testMergeCompletionWithMarksUnionMax(): void
    {
        $k1 = icalCompletionKey('a', '2025-06-15T10:00:00Z');
        $k2 = icalCompletionKey('b', '2025-06-15T11:00:00Z');
        $fromRows = [$k1 => 1, $k2 => 0];
        $marks = [$k2 => 1];
        $merged = icalMergeCompletionWithMarks($fromRows, $marks);
        $this->assertSame(1, $merged[$k1]);
        $this->assertSame(1, $merged[$k2]);
    }
}

