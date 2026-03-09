-- Remove legacy accomplished table; completed panel reads from scheduled_slots (completed = 1).
DROP TABLE IF EXISTS accomplished;

INSERT INTO schema_migrations (filename) VALUES ('011_drop_accomplished.sql');
