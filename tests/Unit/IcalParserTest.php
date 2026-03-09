<?php
/**
 * Phase 5: Unit tests for iCal parser (parseIcalEvents, parseOneVevent).
 */
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once dirname(__DIR__, 2) . '/lib/ical_parser.php';

final class IcalParserTest extends TestCase
{
    public function testMinimalVeventInRange(): void
    {
        $raw = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:ev1@test\r\nSUMMARY:Meeting\r\nDTSTART:20250615T100000\r\nDTEND:20250615T110000\r\nEND:VEVENT\r\nEND:VCALENDAR";
        $events = parseIcalEvents($raw, '2025-06-14', '2025-06-16');
        $this->assertCount(1, $events);
        $this->assertSame('ev1@test', $events[0]['uid']);
        $this->assertSame('Meeting', $events[0]['title']);
        $this->assertStringStartsWith('2025-06-15', $events[0]['start']);
        $this->assertFalse($events[0]['allDay']);
    }

    public function testAllDayEventDateOnly(): void
    {
        $raw = "BEGIN:VEVENT\nUID:allday@test\nSUMMARY:Day off\nDTSTART;VALUE=DATE:20250720\nDTEND;VALUE=DATE:20250721\nEND:VEVENT";
        $events = parseIcalEvents($raw, '2025-07-19', '2025-07-21');
        $this->assertCount(1, $events);
        $this->assertTrue($events[0]['allDay']);
        $this->assertSame('2025-07-20', $events[0]['start']);
        $this->assertSame('2025-07-21', $events[0]['end']);
    }

    public function testEventOutsideRangeNotReturned(): void
    {
        $raw = "BEGIN:VEVENT\nUID:out@test\nSUMMARY:Out\nDTSTART:20250801T090000\nDTEND:20250801T100000\nEND:VEVENT";
        $events = parseIcalEvents($raw, '2025-08-10', '2025-08-15');
        $this->assertSame([], $events);
    }

    public function testMultipleEventsCountAndOrdering(): void
    {
        $raw = "BEGIN:VEVENT\nUID:b@test\nSUMMARY:B\nDTSTART:20250902T140000\nDTEND:20250902T150000\nEND:VEVENT\n"
            . "BEGIN:VEVENT\nUID:a@test\nSUMMARY:A\nDTSTART:20250902T100000\nDTEND:20250902T110000\nEND:VEVENT\n";
        $events = parseIcalEvents($raw, '2025-09-01', '2025-09-03');
        $this->assertCount(2, $events);
        $titles = array_column($events, 'title');
        $this->assertContains('A', $titles);
        $this->assertContains('B', $titles);
    }

    public function testMalformedFeedNoFatal(): void
    {
        $events = parseIcalEvents('not ical at all', '2025-01-01', '2025-12-31');
        $this->assertIsArray($events);
        $this->assertSame([], $events);
    }

    public function testEmptyFeed(): void
    {
        $events = parseIcalEvents('', '2025-01-01', '2025-12-31');
        $this->assertSame([], $events);
    }

    public function testPartialVeventNoEndIgnored(): void
    {
        $raw = "BEGIN:VEVENT\nUID:x@test\nDTSTART:20250601T120000\n";
        $events = parseIcalEvents($raw, '2025-05-01', '2025-06-30');
        $this->assertSame([], $events);
    }
}
