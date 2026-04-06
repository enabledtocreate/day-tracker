-- Tasks due dates + optional auto-priority bump.
-- due_date is a nullable YYYY-MM-DD stored on the tasks row.

ALTER TABLE tasks ADD COLUMN due_date TEXT;

INSERT INTO schema_migrations (filename) VALUES ('019_due_date.sql');

