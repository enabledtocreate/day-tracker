<?php
/**
 * Per-subscription iCal sync status in the user DB (replaces last_fetch.json).
 */

function icalSubscriptionSyncStatusEnsureTable(PDO $pdo): void {
    $pdo->exec("CREATE TABLE IF NOT EXISTS ical_subscription_sync_status (
        subscription_id INTEGER PRIMARY KEY REFERENCES ical_subscriptions(id) ON DELETE CASCADE,
        sync_state TEXT NOT NULL DEFAULT 'idle',
        feed_url TEXT,
        message TEXT,
        error TEXT,
        bytes_fetched INTEGER,
        parsed_count INTEGER,
        range_from TEXT,
        range_to TEXT,
        fetch_file_path TEXT,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )");
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_ical_sub_sync_updated ON ical_subscription_sync_status (updated_at)');
}

/**
 * Merge $patch into existing row and upsert. Accepts legacy keys: state, path.
 */
function icalSubscriptionSyncStatusWrite(PDO $pdo, int $subscriptionId, array $patch): void {
    icalSubscriptionSyncStatusEnsureTable($pdo);
    $sel = $pdo->prepare('SELECT sync_state, feed_url, message, error, bytes_fetched, parsed_count, range_from, range_to, fetch_file_path FROM ical_subscription_sync_status WHERE subscription_id = ?');
    $sel->execute([$subscriptionId]);
    $base = $sel->fetch(PDO::FETCH_ASSOC);
    if (!$base) {
        $base = [
            'sync_state' => 'idle',
            'feed_url' => null,
            'message' => null,
            'error' => null,
            'bytes_fetched' => null,
            'parsed_count' => null,
            'range_from' => null,
            'range_to' => null,
            'fetch_file_path' => null,
        ];
    }

    if (isset($patch['state'])) {
        $base['sync_state'] = (string) $patch['state'];
    }
    if (isset($patch['sync_state'])) {
        $base['sync_state'] = (string) $patch['sync_state'];
    }
    if (array_key_exists('feed_url', $patch)) {
        $fu = $patch['feed_url'];
        $base['feed_url'] = ($fu !== null && $fu !== '') ? (string) $fu : null;
    }
    if (array_key_exists('message', $patch)) {
        $m = $patch['message'];
        $base['message'] = ($m !== null && $m !== '') ? (string) $m : null;
    }
    if (array_key_exists('error', $patch)) {
        $e = $patch['error'];
        $base['error'] = ($e !== null && $e !== '') ? (string) $e : null;
    }
    if (array_key_exists('bytes_fetched', $patch)) {
        $base['bytes_fetched'] = $patch['bytes_fetched'] === null ? null : (int) $patch['bytes_fetched'];
    }
    if (array_key_exists('parsed_count', $patch)) {
        $base['parsed_count'] = $patch['parsed_count'] === null ? null : (int) $patch['parsed_count'];
    }
    if (array_key_exists('range_from', $patch)) {
        $v = $patch['range_from'];
        $base['range_from'] = ($v !== null && $v !== '') ? (string) $v : null;
    }
    if (array_key_exists('range_to', $patch)) {
        $v = $patch['range_to'];
        $base['range_to'] = ($v !== null && $v !== '') ? (string) $v : null;
    }
    if (array_key_exists('path', $patch)) {
        $p = $patch['path'];
        $base['fetch_file_path'] = ($p !== null && $p !== '') ? (string) $p : null;
    }
    if (array_key_exists('fetch_file_path', $patch)) {
        $p = $patch['fetch_file_path'];
        $base['fetch_file_path'] = ($p !== null && $p !== '') ? (string) $p : null;
    }

    $updatedAt = gmdate('Y-m-d\TH:i:s\Z');
    $stmt = $pdo->prepare('INSERT INTO ical_subscription_sync_status (
        subscription_id, sync_state, feed_url, message, error, bytes_fetched, parsed_count, range_from, range_to, fetch_file_path, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(subscription_id) DO UPDATE SET
        sync_state = excluded.sync_state,
        feed_url = excluded.feed_url,
        message = excluded.message,
        error = excluded.error,
        bytes_fetched = excluded.bytes_fetched,
        parsed_count = excluded.parsed_count,
        range_from = excluded.range_from,
        range_to = excluded.range_to,
        fetch_file_path = excluded.fetch_file_path,
        updated_at = excluded.updated_at');
    $stmt->execute([
        $subscriptionId,
        $base['sync_state'],
        $base['feed_url'],
        $base['message'],
        $base['error'],
        $base['bytes_fetched'],
        $base['parsed_count'],
        $base['range_from'],
        $base['range_to'],
        $base['fetch_file_path'],
        $updatedAt,
    ]);
}
