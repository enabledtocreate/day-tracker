-- Named folders for Favorites (common tasks). Tasks reference folder optionally.

CREATE TABLE IF NOT EXISTS favorite_folder (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE tasks ADD COLUMN favorite_folder_id INTEGER REFERENCES favorite_folder(id) ON DELETE SET NULL;

INSERT INTO schema_migrations (filename) VALUES ('029_favorite_folders.sql');
