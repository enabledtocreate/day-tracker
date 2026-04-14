<?php
declare(strict_types=1);

require_once __DIR__ . '/logger.php';

/**
 * Create a stable completion key for one iCal occurrence.
 *
 * Many recurring feeds reuse the same UID for multiple occurrences, so we include
 * start_iso to distinguish each stored row.
 */
function icalCompletionKey(string $uid, string $startIso): string {
    return $uid . '|' . $startIso;
}

function icalGetUserCompletedFromMap(array $completedByKey, string $uid, string $startIso): int {
    $key = icalCompletionKey($uid, $startIso);
    return isset($completedByKey[$key]) ? ((int) ($completedByKey[$key] ?? 0) === 1 ? 1 : 0) : 0;
}

/**
 * Load persistent completion flags for a subscription (§5.15: survives feed re-sync / row replace).
 *
 * @return array<string, 0|1> keyed by icalCompletionKey(uid, start_iso)
 */
function icalLoadCompletionMarks(PDO $pdo, int $subscriptionId): array {
    $map = [];
    try {
        $st = $pdo->prepare('SELECT uid, start_iso, user_completed FROM ical_completion_marks WHERE subscription_id = ?');
        $st->execute([$subscriptionId]);
        while ($row = $st->fetch(PDO::FETCH_ASSOC)) {
            $key = icalCompletionKey((string) ($row['uid'] ?? ''), (string) ($row['start_iso'] ?? ''));
            $map[$key] = ((int) ($row['user_completed'] ?? 0) === 1) ? 1 : 0;
        }
    } catch (Throwable $e) {
        logMessage('NOTICE', 'icalLoadCompletionMarks: table or query failed', ['message' => $e->getMessage()]);
    }

    return $map;
}

/**
 * Merge row-derived completion map with persistent marks (max of each key).
 *
 * @param array<string, 0|1> $fromFeedRowsBeforeDelete
 * @param array<string, 0|1> $marks
 * @return array<string, 0|1>
 */
function icalMergeCompletionWithMarks(array $fromFeedRowsBeforeDelete, array $marks): array {
    $out = $marks;
    foreach ($fromFeedRowsBeforeDelete as $k => $v) {
        $iv = ((int) $v === 1) ? 1 : 0;
        $out[$k] = max($out[$k] ?? 0, $iv);
    }

    return $out;
}

function icalUpsertCompletionMark(PDO $pdo, int $subscriptionId, string $uid, string $startIso, int $userCompleted): void {
    try {
        $st = $pdo->prepare(
            'INSERT INTO ical_completion_marks (subscription_id, uid, start_iso, user_completed) VALUES (?, ?, ?, ?) ' .
            'ON CONFLICT(subscription_id, uid, start_iso) DO UPDATE SET user_completed = excluded.user_completed'
        );
        $st->execute([$subscriptionId, $uid, $startIso, $userCompleted ? 1 : 0]);
    } catch (Throwable $e) {
        logMessage('NOTICE', 'icalUpsertCompletionMark: table or query failed', ['message' => $e->getMessage()]);
    }
}

