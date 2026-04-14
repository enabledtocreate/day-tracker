-- Optional user-facing label for each subscribed calendar (nickname).
ALTER TABLE ical_subscriptions ADD COLUMN display_name TEXT;
INSERT INTO schema_migrations (filename) VALUES ('023_ical_subscription_display_name.sql');
