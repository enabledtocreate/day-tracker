-- Per-subscription iCal sync diagnostics (replaces global last_fetch.json).
CREATE TABLE IF NOT EXISTS ical_subscription_sync_status (
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
);
CREATE INDEX IF NOT EXISTS idx_ical_sub_sync_updated ON ical_subscription_sync_status (updated_at);

INSERT INTO schema_migrations (filename) VALUES ('022_ical_subscription_sync_status.sql');
