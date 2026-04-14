-- Dedicated AI conversation DB (*_ai.sqlite). No FK to main user task DB.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ai_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  title TEXT
);

CREATE TABLE IF NOT EXISTS ai_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  payload_json TEXT NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES ai_threads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_thread ON ai_messages(thread_id, id);

CREATE TRIGGER IF NOT EXISTS ai_thread_touch_after_message
AFTER INSERT ON ai_messages
BEGIN
  UPDATE ai_threads SET updated_at = datetime('now') WHERE id = NEW.thread_id;
END;
