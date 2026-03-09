-- Add list_state to tasks: 'unassigned' (default) or 'pending'.
-- Pending = user has moved the task to the Pending list (for later).
-- Unassigned = default; task appears in Unassigned list.
-- Scheduled/Incomplete/Completed are derived from scheduled_slots and accomplished.

ALTER TABLE tasks ADD COLUMN list_state TEXT NOT NULL DEFAULT 'unassigned';

INSERT INTO schema_migrations (filename) VALUES ('002_task_list_state.sql');
