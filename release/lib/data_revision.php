<?php
/**
 * Cross-device sync revision stored in user DB sync_meta.data_revision.
 */

function dt_get_data_revision(PDO $pdo): string
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS sync_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )");
    $stmt = $pdo->prepare("SELECT value FROM sync_meta WHERE key = 'data_revision'");
    $stmt->execute();
    $value = $stmt->fetchColumn();
    if ($value === false || $value === null || $value === '') {
        $now = date('Y-m-d H:i:s');
        $pdo->prepare("INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('data_revision', ?)")->execute([$now]);
        return $now;
    }
    return (string) $value;
}

function dt_bump_data_revision(PDO $pdo): string
{
    $now = date('Y-m-d H:i:s');
    $pdo->exec("CREATE TABLE IF NOT EXISTS sync_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )");
    $pdo->prepare("INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('data_revision', ?)")->execute([$now]);
    return $now;
}

function dt_table_has_column(PDO $pdo, string $table, string $column): bool
{
    $stmt = $pdo->query('PRAGMA table_info(' . preg_replace('/[^a-zA-Z0-9_]/', '', $table) . ')');
    if (!$stmt) {
        return false;
    }
    $cols = $stmt->fetchAll(PDO::FETCH_ASSOC);
    return in_array($column, array_column($cols, 'name'), true);
}

/** Append `updated_at = datetime('now')` when the column exists (post-migration 036). */
function dt_append_updated_at(array &$updates, PDO $pdo, string $table): void
{
    if (dt_table_has_column($pdo, $table, 'updated_at')) {
        $updates[] = "updated_at = datetime('now')";
    }
}
