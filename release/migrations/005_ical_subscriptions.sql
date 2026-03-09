CREATE TABLE IF NOT EXISTS ical_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO schema_migrations (filename) VALUES ('005_ical_subscriptions.sql');
