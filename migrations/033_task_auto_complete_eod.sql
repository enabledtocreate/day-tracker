-- Tasks can opt into being auto-marked complete at end of day (client-driven).
-- See `.apm/_WORKSPACE/TODO-mobile.md §0.7 / §0.9 Step 8` for the full spec.
-- Boolean stored as INTEGER (SQLite convention): 0 = off, 1 = on.

ALTER TABLE tasks ADD COLUMN auto_complete_eod INTEGER NOT NULL DEFAULT 0;

INSERT INTO schema_migrations (filename) VALUES ('033_task_auto_complete_eod.sql');
