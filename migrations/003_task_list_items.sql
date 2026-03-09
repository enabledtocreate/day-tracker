-- Task list items: per-task bullet list (content, order, collapsible in UI)

CREATE TABLE IF NOT EXISTS task_list_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  order_index INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_task_list_items_task_id ON task_list_items(task_id);

INSERT INTO schema_migrations (filename) VALUES ('003_task_list_items.sql');
