-- Day Tracker initial schema

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('high', 'medium', 'low')),
  recurring INTEGER NOT NULL DEFAULT 0,
  parent_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS task_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  description TEXT,
  UNIQUE(task_id, url)
);

CREATE TABLE IF NOT EXISTS day_record (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS scheduled_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day_record_id INTEGER NOT NULL REFERENCES day_record(id) ON DELETE CASCADE,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  order_index INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS accomplished (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day_record_id INTEGER NOT NULL REFERENCES day_record(id),
  task_id INTEGER NOT NULL,
  title TEXT,
  completed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

INSERT INTO schema_migrations (filename) VALUES ('001_initial.sql');
