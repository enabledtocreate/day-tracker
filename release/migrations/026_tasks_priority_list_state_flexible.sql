-- Remove CHECK on tasks.priority so custom priority slugs (from priority_layout_json) can be stored.
-- list_state was never CHECK-constrained; this migration only rebuilds priority column semantics.

CREATE TABLE IF NOT EXISTS tasks_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium',
  recurring INTEGER NOT NULL DEFAULT 0,
  recurrence_rule TEXT,
  parent_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  list_state TEXT NOT NULL DEFAULT 'unassigned',
  list_style TEXT NOT NULL DEFAULT 'bullet',
  group_order INTEGER NOT NULL DEFAULT 0,
  due_date TEXT,
  is_common INTEGER NOT NULL DEFAULT 0
);
INSERT INTO tasks_new (
  id, title, priority, recurring, recurrence_rule, parent_id, created_at,
  list_state, list_style, group_order, due_date, is_common
)
SELECT
  id, title, priority, recurring, recurrence_rule, parent_id, created_at,
  list_state, list_style,
  COALESCE(group_order, 0),
  due_date,
  COALESCE(is_common, 0)
FROM tasks;
DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;

INSERT INTO schema_migrations (filename) VALUES ('026_tasks_priority_list_state_flexible.sql');
