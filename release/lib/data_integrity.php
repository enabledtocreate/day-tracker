<?php
/**
 * Data integrity: verification and coercion rules.
 * Run on load to ensure stored data is valid. Rules may update the database.
 * Add new rules to the $rules array; each runs in order and can fix then persist.
 */

/**
 * Run all coercion rules. Returns summary of what was fixed.
 *
 * @return array{ok: bool, fixed: array<string, array<int, array>>}
 */
function dataIntegrityRunAll(PDO $pdo): array {
    $fixed = [];

    $rules = [
        'slot_time_frame_nonzero' => 'dataIntegrityCoerceSlotTimeFrame',
    ];

    foreach ($rules as $name => $callable) {
        if (!is_callable($callable)) {
            continue;
        }
        $result = $callable($pdo);
        if (!empty($result)) {
            $fixed[$name] = $result;
        }
    }

    return ['ok' => true, 'fixed' => $fixed];
}

/**
 * Coercion rule: scheduled_slots must not have start_time = end_time.
 * If equal, set end_time to start_time + 1 interval (from app_settings, default 15 min).
 *
 * @return list<array{id: int, before: array, after: array}>
 */
function dataIntegrityCoerceSlotTimeFrame(PDO $pdo): array {
    $intervalMinutes = getScheduleIntervalMinutes($pdo);

    $stmt = $pdo->query("
        SELECT id, start_time, end_time
        FROM scheduled_slots
        WHERE start_time IS NOT NULL AND start_time != ''
          AND end_time IS NOT NULL AND end_time != ''
          AND start_time = end_time
    ");
    $rows = $stmt ? $stmt->fetchAll(PDO::FETCH_ASSOC) : [];
    if (empty($rows)) {
        return [];
    }

    $updated = [];
    $updateStmt = $pdo->prepare("UPDATE scheduled_slots SET end_time = ? WHERE id = ?");

    foreach ($rows as $row) {
        $id = (int) $row['id'];
        $start = trim($row['start_time']);
        $before = ['start_time' => $start, 'end_time' => $row['end_time']];

        $startMin = timeStringToMinutes($start);
        $endMin = $startMin + $intervalMinutes;
        if ($endMin >= 24 * 60) {
            $endMin = 24 * 60 - 1;
        }
        $newEnd = minutesToTimeString($endMin);

        $updateStmt->execute([$newEnd, $id]);
        $updated[] = [
            'id' => $id,
            'before' => $before,
            'after' => ['start_time' => $start, 'end_time' => $newEnd],
        ];
    }

    return $updated;
}

/** Get schedule interval in minutes from app_settings (default 15). */
function getScheduleIntervalMinutes(PDO $pdo): int {
    $stmt = $pdo->query("SELECT key, value FROM app_settings WHERE key IN ('increment_value','increment_unit')");
    $rows = $stmt ? $stmt->fetchAll(PDO::FETCH_KEY_PAIR) : [];
    $value = (int) ($rows['increment_value'] ?? 15);
    $unit = $rows['increment_unit'] ?? 'min';
    if ($unit === 'hr') {
        return $value * 60;
    }
    return $value;
}

/** Parse "HH:MM" or "H:MM" to minutes since midnight. */
function timeStringToMinutes(string $time): int {
    $parts = array_map('intval', explode(':', $time, 2));
    $h = $parts[0] ?? 0;
    $m = $parts[1] ?? 0;
    return $h * 60 + $m;
}

/** Format minutes since midnight to "HH:MM". */
function minutesToTimeString(int $minutes): string {
    $minutes = max(0, min(24 * 60 - 1, $minutes));
    $h = (int) floor($minutes / 60);
    $m = $minutes % 60;
    return sprintf('%02d:%02d', $h, $m);
}

/**
 * Coerce a single (start_time, end_time) pair so end != start when both set.
 * Use when creating or updating a slot to prevent zero-duration slots.
 *
 * @return array{0: ?string, 1: ?string} [start_time, end_time] possibly coerced
 */
function dataIntegrityCoerceSlotTimeFramePair(PDO $pdo, ?string $startTime, ?string $endTime): array {
    $s = $startTime !== null && trim($startTime) !== '' ? trim($startTime) : null;
    $e = $endTime !== null && trim($endTime) !== '' ? trim($endTime) : null;
    if ($s === null || $e === null || $s !== $e) {
        return [$startTime, $endTime];
    }
    $intervalMinutes = getScheduleIntervalMinutes($pdo);
    $startMin = timeStringToMinutes($s);
    $endMin = $startMin + $intervalMinutes;
    if ($endMin >= 24 * 60) {
        $endMin = 24 * 60 - 1;
    }
    return [$startTime, minutesToTimeString($endMin)];
}
