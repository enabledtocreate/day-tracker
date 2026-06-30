-- Optional muted tint for events from this subscription on the schedule.

ALTER TABLE ical_subscriptions ADD COLUMN schedule_color TEXT;

INSERT INTO schema_migrations (filename) VALUES ('024_ical_subscription_schedule_color.sql');
