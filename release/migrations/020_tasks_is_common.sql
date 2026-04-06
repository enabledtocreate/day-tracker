-- Common Tasks: reusable templates (orange border in UI). Scheduling uses a copy, not the template row.
ALTER TABLE tasks ADD COLUMN is_common INTEGER NOT NULL DEFAULT 0;
