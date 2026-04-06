-- §5.15: Persist iCal per-occurrence completion when feed rows are replaced or events vanish from feed.
CREATE TABLE IF NOT EXISTS ical_completion_marks (
  subscription_id INTEGER NOT NULL,
  uid TEXT NOT NULL,
  start_iso TEXT NOT NULL,
  user_completed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (subscription_id, uid, start_iso)
);
CREATE INDEX IF NOT EXISTS idx_ical_completion_marks_sub ON ical_completion_marks (subscription_id);

INSERT INTO schema_migrations (filename) VALUES ('021_ical_completion_marks.sql');
