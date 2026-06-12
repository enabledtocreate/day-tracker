<?php
/**
 * Priority / bucket layout from app_settings (default vs custom slugs).
 * Used by tasks.php for validation.
 */
declare(strict_types=1);

/** @return array<string, string> */
function dt_app_settings_subset(PDO $pdo, array $keys): array
{
    if ($keys === []) {
        return [];
    }
    $placeholders = implode(',', array_fill(0, count($keys), '?'));
    $stmt = $pdo->prepare("SELECT key, value FROM app_settings WHERE key IN ({$placeholders})");
    $stmt->execute($keys);
    $rows = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);

    return is_array($rows) ? $rows : [];
}

function dt_slug_ok(string $s): bool
{
    return $s !== '' && strlen($s) <= 32 && (bool) preg_match('/^[a-z0-9_-]+$/', $s);
}

/**
 * @param array<string, string> $rows
 * @return array{priority_mode:string, priority_ids:string[], bucket_mode:string, bucket_ids:string[]}
 */
function dt_task_layout_from_settings_rows(array $rows): array
{
    $defaultPriority = ['commitment', 'high', 'medium', 'low'];
    $defaultBuckets = ['unassigned', 'pending'];

    $priorityMode = 'default';
    $priorityIds = $defaultPriority;
    $rawPl = $rows['priority_layout_json'] ?? '';
    if ($rawPl !== '') {
        $decoded = json_decode($rawPl, true);
        if (is_array($decoded) && ($decoded['mode'] ?? '') === 'custom' && isset($decoded['priorities']) && is_array($decoded['priorities'])) {
            $ids = [];
            foreach ($decoded['priorities'] as $row) {
                if (!is_array($row)) {
                    continue;
                }
                $id = isset($row['id']) ? trim((string) $row['id']) : '';
                if (dt_slug_ok($id)) {
                    $ids[] = $id;
                }
            }
            $ids = array_values(array_unique($ids));
            if (count($ids) >= 2 && count($ids) <= 24) {
                $priorityMode = 'custom';
                $priorityIds = $ids;
            }
        }
    }

    $bucketMode = 'default';
    $bucketIds = $defaultBuckets;
    $rawBl = $rows['bucket_layout_json'] ?? '';
    if ($rawBl !== '') {
        $decoded = json_decode($rawBl, true);
        if (is_array($decoded) && ($decoded['mode'] ?? '') === 'custom' && isset($decoded['buckets']) && is_array($decoded['buckets'])) {
            $ids = [];
            foreach ($decoded['buckets'] as $row) {
                if (!is_array($row)) {
                    continue;
                }
                $id = isset($row['id']) ? trim((string) $row['id']) : '';
                if (dt_slug_ok($id)) {
                    $ids[] = $id;
                }
            }
            $ids = array_values(array_unique($ids));
            if (count($ids) >= 2 && count($ids) <= 16) {
                $bucketMode = 'custom';
                $bucketIds = $ids;
            }
        }
    }

    return [
        'priority_mode' => $priorityMode,
        'priority_ids' => $priorityIds,
        'bucket_mode' => $bucketMode,
        'bucket_ids' => $bucketIds,
    ];
}

/** @return array{priority_mode:string, priority_ids:string[], bucket_mode:string, bucket_ids:string[]} */
function dt_task_layout_from_pdo(PDO $pdo): array
{
    $rows = dt_app_settings_subset($pdo, ['priority_layout_json', 'bucket_layout_json']);

    return dt_task_layout_from_settings_rows($rows);
}

/**
 * @param array{priority_mode:string, priority_ids:string[], bucket_mode:string, bucket_ids:string[]} $layout
 */
function dt_is_allowed_priority(string $p, array $layout): bool
{
    return in_array($p, $layout['priority_ids'], true);
}

/**
 * @param array{priority_mode:string, priority_ids:string[], bucket_mode:string, bucket_ids:string[]} $layout
 */
function dt_is_allowed_list_state(string $s, array $layout): bool
{
    return in_array($s, $layout['bucket_ids'], true);
}

/**
 * @param array{priority_mode:string, priority_ids:string[], bucket_mode:string, bucket_ids:string[]} $layout
 */
function dt_is_allowed_due_auto_target(string $p, array $layout): bool
{
    return in_array($p, $layout['priority_ids'], true);
}
