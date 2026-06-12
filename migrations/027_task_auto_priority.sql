-- Per-task auto-raise priority (by calendar days or by due date interpolation).

ALTER TABLE tasks ADD COLUMN auto_priority_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN auto_priority_mode TEXT NOT NULL DEFAULT 'days';
ALTER TABLE tasks ADD COLUMN auto_priority_days_per_step INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tasks ADD COLUMN auto_priority_anchor_date TEXT;
ALTER TABLE tasks ADD COLUMN auto_priority_anchor_priority TEXT;

INSERT INTO schema_migrations (filename) VALUES ('027_task_auto_priority.sql');
