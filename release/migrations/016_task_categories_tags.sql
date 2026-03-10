-- Task categories, subcategories, and tags (one category, one subcategory, many tags per task)

CREATE TABLE IF NOT EXISTS task_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT
);

CREATE TABLE IF NOT EXISTS task_subcategories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES task_categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT
);

CREATE TABLE IF NOT EXISTS task_category (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES task_categories(id) ON DELETE SET NULL,
  PRIMARY KEY (task_id)
);

CREATE TABLE IF NOT EXISTS task_subcategory (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  subcategory_id INTEGER REFERENCES task_subcategories(id) ON DELETE SET NULL,
  PRIMARY KEY (task_id)
);

CREATE TABLE IF NOT EXISTS task_tag (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES task_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);

INSERT INTO schema_migrations (filename) VALUES ('016_task_categories_tags.sql');
