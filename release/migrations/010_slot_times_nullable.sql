-- Allow scheduled_slots without time (date-only): start_time and end_time nullable.
CREATE TABLE scheduled_slots_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day_record_id INTEGER NOT NULL REFERENCES day_record(id) ON DELETE CASCADE,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  start_time TEXT,
  end_time TEXT,
  completed INTEGER NOT NULL DEFAULT 0,
  order_index INTEGER NOT NULL DEFAULT 0
);
INSERT INTO scheduled_slots_new (id, day_record_id, task_id, start_time, end_time, completed, order_index)
SELECT id, day_record_id, task_id, start_time, end_time, completed, order_index FROM scheduled_slots;
DROP TABLE scheduled_slots;
ALTER TABLE scheduled_slots_new RENAME TO scheduled_slots;

INSERT INTO schema_migrations (filename) VALUES ('010_slot_times_nullable.sql');
