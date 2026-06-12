<?php
/**
 * Convert internal recurrence rule (JSON array) to RFC 5545 RRULE string.
 * Used for iCal export (api/ical.php).
 *
 * @param array{ freq?: string, weekDays?: int[], monthDays?: int[], lastDayOfMonth?: bool, count?: int, until?: string, endDate?: string } $rule
 * @return string RRULE value (e.g. "FREQ=WEEKLY;BYDAY=MO,WE" or "FREQ=DAILY")
 */
function recurrenceRuleJsonToRrule(array $rule): string {
    $freq = strtoupper($rule['freq'] ?? 'daily');
    $parts = ['FREQ=' . $freq];

    if ($freq === 'WEEKLY') {
        $weekDays = $rule['weekDays'] ?? [];
        if (!empty($weekDays)) {
            $byday = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
            $days = [];
            foreach ($weekDays as $d) {
                if (isset($byday[(int) $d])) {
                    $days[] = $byday[(int) $d];
                }
            }
            if (!empty($days)) {
                $parts[] = 'BYDAY=' . implode(',', $days);
            }
        }
    }

    if ($freq === 'MONTHLY') {
        $monthDays = $rule['monthDays'] ?? [];
        $lastDayOfMonth = !empty($rule['lastDayOfMonth']);
        $days = array_filter(array_map('intval', $monthDays), fn($d) => $d >= 1 && $d <= 31);
        if ($lastDayOfMonth) {
            $days[] = -1;
        }
        if (!empty($days)) {
            $parts[] = 'BYMONTHDAY=' . implode(',', array_unique($days));
        }
    }

    if (isset($rule['count']) && (int) $rule['count'] > 0) {
        $parts[] = 'COUNT=' . (int) $rule['count'];
    }
    $until = $rule['until'] ?? $rule['endDate'] ?? null;
    if (is_string($until) && preg_match('/^\d{4}-\d{2}-\d{2}/', $until)) {
        $until = substr($until, 0, 10);
        $parts[] = 'UNTIL=' . str_replace('-', '', $until) . 'T235959Z';
    }

    return implode(';', $parts);
}

/** Last inclusive calendar day of a recurrence series, if set (matches lib/recurrence.php). */
function recurrenceSeriesEndDateInclusive(?array $rule): ?string {
    if ($rule === null) {
        return null;
    }
    $end = $rule['endDate'] ?? $rule['until'] ?? null;
    if (!is_string($end) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $end)) {
        return null;
    }
    return $end;
}
