ALTER TABLE ical_subscriptions ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
INSERT INTO schema_migrations (filename) VALUES ('006_ical_subscriptions_enabled.sql');
