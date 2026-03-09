-- Store parsed iCal feed events (sync-and-store). Recurring events stored as expanded occurrences.
CREATE TABLE IF NOT EXISTS ical_feed_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER NOT NULL REFERENCES ical_subscriptions(id) ON DELETE CASCADE,
  uid TEXT NOT NULL,
  title TEXT NOT NULL,
  start_iso TEXT NOT NULL,
  end_iso TEXT NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ical_feed_events_sub_start ON ical_feed_events (subscription_id, start_iso);

ALTER TABLE ical_subscriptions ADD COLUMN last_synced_at TEXT;

INSERT INTO schema_migrations (filename) VALUES ('013_ical_feed_events.sql');
