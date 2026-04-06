-- Performance: preserve/lookup iCal completion markers using (subscription_id, uid, start_iso)
CREATE INDEX IF NOT EXISTS idx_ical_feed_events_sub_uid_start ON ical_feed_events (subscription_id, uid, start_iso);

INSERT INTO schema_migrations (filename) VALUES ('017_ical_feed_events_uid_start_index.sql');

