-- Omit task slot hours from Today/Week/Calendar planned-hours summaries (e.g. sleep).
-- Boolean stored as INTEGER (SQLite convention): 0 = count hours, 1 = exclude.

ALTER TABLE tasks ADD COLUMN exclude_from_planned_hours INTEGER NOT NULL DEFAULT 0;

INSERT INTO schema_migrations (filename) VALUES ('038_task_exclude_from_planned_hours.sql');
