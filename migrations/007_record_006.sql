-- Record 006 so it is not re-run (fixes DBs where column already exists but 006 was never recorded)
INSERT OR IGNORE INTO schema_migrations (filename) VALUES ('006_ical_subscriptions_enabled.sql');
INSERT INTO schema_migrations (filename) VALUES ('007_record_006.sql');
