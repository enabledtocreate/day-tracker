<?php
/**
 * iCal (RFC 5545) parser: extract VEVENTs and filter by date range.
 * Used by ical_events.php and ical_subscriptions.php (preview).
 */

/**
 * Parse iCal string and return events overlapping [fromDate, toDate].
 * Returns array of { uid, title, start, end, allDay } with start/end as ISO 8601.
 */
function parseIcalEvents(string $raw, string $fromDate, string $toDate): array {
    $raw = str_replace("\r\n", "\n", $raw);
    $raw = str_replace("\r", "\n", $raw);
    if (substr($raw, 0, 3) === "\xEF\xBB\xBF") {
        $raw = substr($raw, 3);
    }
    $lines = [];
    $current = '';
    foreach (explode("\n", $raw) as $line) {
        if ($line !== '' && ($line[0] === ' ' || $line[0] === "\t")) {
            $current .= substr($line, 1);
        } else {
            if ($current !== '') $lines[] = $current;
            $current = $line;
        }
    }
    if ($current !== '') $lines[] = $current;

    $events = [];
    $inEvent = false;
    $inAlarm = false;
    $eventLines = [];

    foreach ($lines as $line) {
        if (strtoupper(substr($line, 0, 12)) === 'BEGIN:VEVENT') {
            $inEvent = true;
            $inAlarm = false;
            $eventLines = [$line];
            continue;
        }
        if ($inEvent) {
            if (strtoupper(substr($line, 0, 11)) === 'BEGIN:VALARM') {
                $inAlarm = true;
                continue;
            }
            if ($inAlarm) {
                if (strtoupper(substr($line, 0, 9)) === 'END:VALARM') {
                    $inAlarm = false;
                }
                continue;
            }
            $eventLines[] = $line;
            if (strtoupper(substr($line, 0, 10)) === 'END:VEVENT') {
                $evList = parseOneVevent($eventLines, $fromDate, $toDate);
                foreach ($evList as $ev) {
                    $events[] = $ev;
                }
                $inEvent = false;
            }
        }
    }

    $inTodo = false;
    $inAlarmTodo = false;
    $todoLines = [];
    foreach ($lines as $line) {
        if (strtoupper(substr($line, 0, 11)) === 'BEGIN:VTODO') {
            $inTodo = true;
            $inAlarmTodo = false;
            $todoLines = [$line];
            continue;
        }
        if ($inTodo) {
            if (strtoupper(substr($line, 0, 11)) === 'BEGIN:VALARM') {
                $inAlarmTodo = true;
                continue;
            }
            if ($inAlarmTodo) {
                if (strtoupper(substr($line, 0, 9)) === 'END:VALARM') $inAlarmTodo = false;
                continue;
            }
            $todoLines[] = $line;
            if (strtoupper(substr($line, 0, 9)) === 'END:VTODO') {
                $evList = parseOneVtodo($todoLines, $fromDate, $toDate);
                foreach ($evList as $ev) {
                    $events[] = $ev;
                }
                $inTodo = false;
            }
        }
    }

    return $events;
}

/**
 * Parse EXDATE line(s) and return list of excluded dates as Y-m-d.
 */
function parseExdates(array $lines): array {
    $exdates = [];
    foreach ($lines as $line) {
        if (stripos($line, 'EXDATE') !== 0) continue;
        $dateOnly = (stripos($line, 'VALUE=DATE') !== false);
        $idx = strrpos($line, ':');
        if ($idx === false) continue;
        $value = trim(substr($line, $idx + 1));
        foreach (array_map('trim', explode(',', $value)) as $v) {
            if ($v === '') continue;
            $iso = icalValueToIso($v, $dateOnly || strlen($v) === 8);
            if ($iso !== null) {
                $exdates[substr($iso, 0, 10)] = true;
            }
        }
    }
    return array_keys($exdates);
}

/**
 * @return array<array{uid: string, title: string, start: string, end: string, allDay: bool}>
 */
function parseOneVevent(array $lines, string $fromDate, string $toDate): array {
    $uid = $summary = $dtStart = $dtEnd = $rrule = null;
    $allDay = false;

    foreach ($lines as $line) {
        if (stripos($line, 'UID') === 0 && ($idx = strrpos($line, ':')) !== false) {
            $uid = unescapeIcalText(trim(substr($line, $idx + 1)));
        } elseif (stripos($line, 'SUMMARY') === 0 && ($idx = strrpos($line, ':')) !== false) {
            $summary = unescapeIcalText(trim(substr($line, $idx + 1)));
        } elseif (stripos($line, 'DTSTART') === 0) {
            $pair = parseIcalDateTimeLine($line, 'DTSTART');
            $dtStart = $pair['value'];
            $allDay = $pair['dateOnly'];
        } elseif (stripos($line, 'DTEND') === 0) {
            $pair = parseIcalDateTimeLine($line, 'DTEND');
            $dtEnd = $pair['value'];
        } elseif (stripos($line, 'RRULE:') === 0) {
            $rrule = trim(substr($line, 6));
        }
    }

    if ($uid === null || $dtStart === null) return [];
    if ($dtEnd === null) $dtEnd = $dtStart;

    $title = $summary !== null && $summary !== '' ? $summary : 'Event';

    $startIso = icalValueToIso($dtStart, $allDay);
    $endIso = icalValueToIso($dtEnd, $allDay);
    if ($startIso === null) return [];

    $exdates = parseExdates($lines);

    $events = [];
    if ($rrule !== null) {
        // Recurring events: delegate to RRULE expansion with proper range handling.
        $events = expandRrule($startIso, $endIso ?? $startIso, $allDay, $rrule, $fromDate, $toDate, $uid, $title, $exdates);
    } else {
        // Non-recurring events: include if they overlap [fromDate, toDate] (inclusive).
        $startDate = substr($startIso, 0, 10);
        $endDate = substr($endIso ?? $startIso, 0, 10);
        if ($endDate < $fromDate || $startDate > $toDate) {
            return [];
        }
        $events[] = [
            'uid' => $uid,
            'title' => $title,
            'start' => $startIso,
            'end' => $endIso ?? $startIso,
            'allDay' => $allDay,
            'event_type' => 'event',
        ];
    }
    return $events;
}

/**
 * Parse VTODO component and return 0 or 1 occurrence if in range. No RRULE expansion for VTODO.
 * @return array<array{uid: string, title: string, start: string, end: string, allDay: bool, event_type: string}>
 */
function parseOneVtodo(array $lines, string $fromDate, string $toDate): array {
    $uid = $summary = $dtStart = $due = $dtEnd = null;
    $allDay = false;
    foreach ($lines as $line) {
        if (stripos($line, 'UID') === 0 && ($idx = strrpos($line, ':')) !== false) {
            $uid = unescapeIcalText(trim(substr($line, $idx + 1)));
        } elseif (stripos($line, 'SUMMARY') === 0 && ($idx = strrpos($line, ':')) !== false) {
            $summary = unescapeIcalText(trim(substr($line, $idx + 1)));
        } elseif (stripos($line, 'DTSTART') === 0) {
            $pair = parseIcalDateTimeLine($line, 'DTSTART');
            $dtStart = $pair['value'];
            $allDay = $pair['dateOnly'];
        } elseif (stripos($line, 'DUE') === 0 && ($idx = strrpos($line, ':')) !== false) {
            $v = trim(substr($line, $idx + 1));
            $dateOnly = (stripos($line, 'VALUE=DATE') !== false);
            $due = icalValueToIso($v, $dateOnly || strlen($v) === 8);
        } elseif (stripos($line, 'DTEND') === 0) {
            $pair = parseIcalDateTimeLine($line, 'DTEND');
            $dtEnd = $pair['value'];
        }
    }
    if ($uid === null) return [];
    $startIso = $dtStart !== null ? icalValueToIso($dtStart, $allDay) : $due;
    $endIso = $due ?? ($dtEnd !== null ? icalValueToIso($dtEnd, $allDay) : null) ?? $startIso;
    if ($startIso === null) return [];
    if ($endIso === null) $endIso = $startIso;
    $startDate = substr($startIso, 0, 10);
    $endDate = substr($endIso, 0, 10);
    if ($endDate < $fromDate || $startDate > $toDate) return [];
    $title = $summary !== null && $summary !== '' ? $summary : 'To-do';
    return [[
        'uid' => $uid,
        'title' => $title,
        'start' => $startIso,
        'end' => $endIso,
        'allDay' => $allDay,
        'event_type' => 'todo',
    ]];
}

/** Map BYDAY abbreviation to PHP date('w') Sunday=0. Handles "MO", "2MO", "-1FR" etc. */
function icalBydayToDow(string $byday): ?int {
    $map = ['SU' => 0, 'MO' => 1, 'TU' => 2, 'WE' => 3, 'TH' => 4, 'FR' => 5, 'SA' => 6];
    $s = strtoupper(trim($byday));
    $key = strlen($s) >= 2 ? substr($s, -2) : $s;
    return isset($map[$key]) ? $map[$key] : null;
}

/**
 * Simple RRULE expansion. Supports FREQ=DAILY, WEEKLY (with BYDAY), MONTHLY (with BYMONTHDAY), YEARLY. Others: show first occurrence only if in range.
 * @param array<string> $exdates Excluded dates (Y-m-d) from EXDATE; these occurrences are skipped.
 */
function expandRrule(string $startIso, string $endIso, bool $allDay, string $rrule, string $fromDate, string $toDate, string $uid, string $title, array $exdates = []): array {
    $freq = null;
    $count = null;
    $until = null;
    $interval = 1;
    $byday = [];
    $bymonthday = [];
    foreach (explode(';', $rrule) as $part) {
        $kv = explode('=', $part, 2);
        if (count($kv) !== 2) continue;
        $k = strtoupper(trim($kv[0]));
        $v = trim($kv[1]);
        if ($k === 'FREQ') $freq = strtoupper($v);
        elseif ($k === 'COUNT') $count = (int) $v;
        elseif ($k === 'UNTIL') $until = $v;
        elseif ($k === 'INTERVAL') $interval = max(1, (int) $v);
        elseif ($k === 'BYDAY') {
            foreach (explode(',', $v) as $d) {
                $dow = icalBydayToDow($d);
                if ($dow !== null) $byday[] = $dow;
            }
            $byday = array_values(array_unique($byday));
        }
        elseif ($k === 'BYMONTHDAY') {
            foreach (explode(',', $v) as $d) {
                $d = (int) $d;
                if ($d >= 1 && $d <= 31) $bymonthday[] = $d;
                elseif ($d === -1) $bymonthday[] = -1;
            }
            $bymonthday = array_values(array_unique($bymonthday));
        }
    }
    $startTs = strtotime($startIso);
    $endTs = strtotime($endIso);
    $duration = $endTs - $startTs;
    $fromTs = strtotime($fromDate . ' 00:00:00');
    $toTs = strtotime($toDate . ' 23:59:59');

    $exdatesSet = array_flip($exdates);
    if ($freq !== 'DAILY' && $freq !== 'WEEKLY' && $freq !== 'MONTHLY' && $freq !== 'YEARLY') {
        $startDate = substr($startIso, 0, 10);
        if (($startTs <= $toTs && $endTs >= $fromTs) && !isset($exdatesSet[$startDate])) {
            return [[
                'uid' => $uid,
                'title' => $title,
                'start' => $startIso,
                'end' => $endIso,
                'allDay' => $allDay,
                'event_type' => 'event',
            ]];
        }
        return [];
    }

    $events = [];
    $current = $startTs;
    $n = 0;
    $max = 1500;
    $hasTime = (strpos($startIso, 'T') !== false);
    $startTimeSuffix = $hasTime ? substr($startIso, 10) : '';
    $endTimeSuffix = (strpos($endIso, 'T') !== false) ? substr($endIso, 10) : '';

    $weekdayMatches = function (int $ts) use ($byday): bool {
        if (empty($byday)) return true;
        return in_array((int) date('w', $ts), $byday, true);
    };
    $monthdayMatches = function (int $ts) use ($bymonthday): bool {
        if (empty($bymonthday)) return true;
        $dom = (int) date('j', $ts);
        $last = (int) date('t', $ts);
        foreach ($bymonthday as $d) {
            if ($d === -1 && $dom === $last) return true;
            if ($d === $dom) return true;
        }
        return false;
    };

    while ($n < $max && $current <= $toTs) {
        $match = true;
        if ($freq === 'WEEKLY' && !empty($byday)) $match = $weekdayMatches($current);
        if ($match && $freq === 'MONTHLY' && !empty($bymonthday)) $match = $monthdayMatches($current);

        $intervalMatch = true;
        if ($freq === 'WEEKLY' && !empty($byday) && $interval > 1) {
            $weeksSinceStart = (int) floor(($current - $startTs) / (7 * 86400));
            $intervalMatch = ($weeksSinceStart % $interval === 0);
        }
        $occStart = date('Y-m-d', $current) . $startTimeSuffix;
        $occStartDate = substr($occStart, 0, 10);
        $excluded = isset($exdatesSet[$occStartDate]);
        if ($match && $intervalMatch && !$excluded && $current + $duration >= $fromTs) {
            $occEnd = date('Y-m-d', $current + $duration) . $endTimeSuffix;
            if (!$hasTime) $occEnd = date('Y-m-d', $current + $duration);
            $events[] = [
                'uid' => $uid,
                'title' => $title,
                'start' => $occStart,
                'end' => $occEnd,
                'allDay' => $allDay,
                'event_type' => 'event',
            ];
        }
        if ($count !== null && count($events) >= $count) break;
        if ($until !== null) {
            $untilTs = (strlen($until) <= 8) ? strtotime($until . ' 23:59:59') : strtotime(str_replace('Z', ' UTC', $until));
            if ($current > $untilTs) break;
        }
        if ($freq === 'DAILY') {
            $current += 86400 * $interval;
        } elseif ($freq === 'WEEKLY') {
            if (!empty($byday)) {
                $current += 86400;
            } else {
                $current += 7 * 86400 * $interval;
            }
        } elseif ($freq === 'YEARLY') {
            for ($i = 0; $i < $interval; $i++) {
                $current = strtotime('+1 year', $current);
            }
        } else {
            for ($i = 0; $i < $interval; $i++) {
                $current = strtotime(date('Y-m-d', $current) . $startTimeSuffix . ' +1 month');
            }
        }
        $n++;
    }
    return $events;
}

function unescapeIcalText(string $s): string {
    return str_replace(['\\n', '\\N', '\\,', '\\;', '\\\\'], ["\n", "\n", ',', ';', '\\'], $s);
}

function parseIcalDateTimeLine(string $line, string $prefix): array {
    $dateOnly = (stripos($line, 'VALUE=DATE') !== false);
    $idx = strrpos($line, ':');
    $value = ($idx !== false) ? trim(substr($line, $idx + 1)) : '';
    return ['value' => $value, 'dateOnly' => $dateOnly];
}

function icalValueToIso(string $value, bool $dateOnly): ?string {
    $value = trim($value);
    if ($dateOnly || strlen($value) === 8) {
        if (preg_match('/^(\d{4})(\d{2})(\d{2})$/', $value, $m)) {
            return $m[1] . '-' . $m[2] . '-' . $m[3];
        }
        return null;
    }
    if (preg_match('/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/', $value, $m)) {
        $iso = $m[1] . '-' . $m[2] . '-' . $m[3] . 'T' . $m[4] . ':' . $m[5] . ':' . $m[6];
        if (substr($value, -1) === 'Z') $iso .= 'Z';
        return $iso;
    }
    return null;
}
