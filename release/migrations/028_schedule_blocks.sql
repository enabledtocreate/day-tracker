-- Block definitions and scheduled block instances.

CREATE TABLE IF NOT EXISTS task_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT
);

CREATE TABLE IF NOT EXISTS schedule_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day_record_id INTEGER NOT NULL REFERENCES day_record(id) ON DELETE CASCADE,
  block_id INTEGER NOT NULL REFERENCES task_blocks(id) ON DELETE CASCADE,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_schedule_blocks_day ON schedule_blocks (day_record_id);
CREATE INDEX IF NOT EXISTS idx_schedule_blocks_block ON schedule_blocks (block_id);

INSERT INTO schema_migrations (filename) VALUES ('028_schedule_blocks.sql');
