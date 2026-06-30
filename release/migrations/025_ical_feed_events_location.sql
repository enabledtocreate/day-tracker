-- VEVENT/VTODO LOCATION field (plain text or URL).

ALTER TABLE ical_feed_events ADD COLUMN location TEXT;

INSERT INTO schema_migrations (filename) VALUES ('025_ical_feed_events_location.sql');
