-- Tracks per-day recurring occurrence state:
-- - completed_for_day: temporary completion marker for today's recurring occurrence
-- - overridden_task_id: one-off derivative task for a specific day (series exception)
CREATE TABLE IF NOT EXISTS recurring_occurrence_state (
  recurring_task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  occurrence_date TEXT NOT NULL,
  completed_for_day INTEGER NOT NULL DEFAULT 0,
  overridden_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  source_slot_id INTEGER REFERENCES scheduled_slots(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (recurring_task_id, occurrence_date)
);

CREATE INDEX IF NOT EXISTS idx_recurring_occurrence_state_day
  ON recurring_occurrence_state (occurrence_date);

INSERT INTO schema_migrations (filename) VALUES ('024_recurring_occurrence_state.sql');
