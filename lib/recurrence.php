<?php
/**
 * Recurrence rules: match a date against a recurrence rule (JSON: freq, weekDays, monthDays, lastDayOfMonth).
 */

/**
 * @param array{ freq?: string, weekDays?: int[], monthDays?: int[], lastDayOfMonth?: bool }|null $rule
 * When rule is null or empty, treat as daily (matches every date).
 */
function recurrenceMatchesDate(?array $rule, string $date): bool {
    $ts = strtotime($date . ' 00:00:00');
    if ($ts === false) return false;
    if ($rule === null || $rule === []) {
        return true;
    }
    $freq = $rule['freq'] ?? 'daily';
    if ($freq === 'daily') return true;
    if ($freq === 'weekly') {
        $dow = (int) date('w', $ts);
        $weekDays = $rule['weekDays'] ?? [];
        return in_array($dow, $weekDays, true);
    }
    if ($freq === 'monthly') {
        $dom = (int) date('j', $ts);
        if (!empty($rule['lastDayOfMonth']) && $dom === (int) date('t', $ts)) return true;
        $monthDays = $rule['monthDays'] ?? [];
        return in_array($dom, $monthDays, true);
    }
    if ($freq === 'yearly') {
        $startDate = $rule['startDate'] ?? null;
        if ($startDate !== null && preg_match('/^\d{4}-\d{2}-\d{2}$/', $startDate)) {
            $startTs = strtotime($startDate . ' 00:00:00');
            if ($startTs === false) return false;
            return date('m-d', $ts) === date('m-d', $startTs);
        }
        return true;
    }
    return false;
}
