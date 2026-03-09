-- Allow 'commitment' in tasks.priority (SQLite cannot alter CHECK; recreate table).
CREATE TABLE IF NOT EXISTS tasks_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('commitment', 'high', 'medium', 'low')),
  recurring INTEGER NOT NULL DEFAULT 0,
  parent_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  list_state TEXT NOT NULL DEFAULT 'unassigned',
  list_style TEXT NOT NULL DEFAULT 'bullet'
);
INSERT INTO tasks_new (id, title, priority, recurring, parent_id, created_at, list_state, list_style)
SELECT id, title, priority, recurring, parent_id, created_at, list_state, list_style FROM tasks;
DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;

INSERT INTO schema_migrations (filename) VALUES ('008_priority_commitment.sql');
