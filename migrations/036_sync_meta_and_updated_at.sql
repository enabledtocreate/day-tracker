-- Cross-device sync: monotonic data_revision + per-row updated_at on core mutable tables.

CREATE TABLE IF NOT EXISTS sync_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO sync_meta (key, value) VALUES ('data_revision', datetime('now'));

-- SQLite ALTER TABLE only allows constant defaults; backfill after ADD COLUMN.
ALTER TABLE tasks ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
UPDATE tasks SET updated_at = COALESCE(created_at, datetime('now')) WHERE updated_at = '';
ALTER TABLE scheduled_slots ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
UPDATE scheduled_slots SET updated_at = datetime('now') WHERE updated_at = '';
ALTER TABLE task_links ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
UPDATE task_links SET updated_at = datetime('now') WHERE updated_at = '';
ALTER TABLE task_list_items ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
UPDATE task_list_items SET updated_at = datetime('now') WHERE updated_at = '';
ALTER TABLE schedule_blocks ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
UPDATE schedule_blocks SET updated_at = datetime('now') WHERE updated_at = '';

-- Bump data_revision when app data changes (client polls sync.php).
CREATE TRIGGER sync_bump_tasks_ins AFTER INSERT ON tasks BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;
CREATE TRIGGER sync_bump_tasks_upd AFTER UPDATE ON tasks BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;
CREATE TRIGGER sync_bump_tasks_del AFTER DELETE ON tasks BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;

CREATE TRIGGER sync_bump_slots_ins AFTER INSERT ON scheduled_slots BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;
CREATE TRIGGER sync_bump_slots_upd AFTER UPDATE ON scheduled_slots BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;
CREATE TRIGGER sync_bump_slots_del AFTER DELETE ON scheduled_slots BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;

CREATE TRIGGER sync_bump_links_ins AFTER INSERT ON task_links BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;
CREATE TRIGGER sync_bump_links_upd AFTER UPDATE ON task_links BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;
CREATE TRIGGER sync_bump_links_del AFTER DELETE ON task_links BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;

CREATE TRIGGER sync_bump_list_items_ins AFTER INSERT ON task_list_items BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;
CREATE TRIGGER sync_bump_list_items_upd AFTER UPDATE ON task_list_items BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;
CREATE TRIGGER sync_bump_list_items_del AFTER DELETE ON task_list_items BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;

CREATE TRIGGER sync_bump_schedule_blocks_ins AFTER INSERT ON schedule_blocks BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;
CREATE TRIGGER sync_bump_schedule_blocks_upd AFTER UPDATE ON schedule_blocks BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;
CREATE TRIGGER sync_bump_schedule_blocks_del AFTER DELETE ON schedule_blocks BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;

CREATE TRIGGER sync_bump_task_category_ins AFTER INSERT ON task_category BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;
CREATE TRIGGER sync_bump_task_category_upd AFTER UPDATE ON task_category BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;
CREATE TRIGGER sync_bump_task_category_del AFTER DELETE ON task_category BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;

CREATE TRIGGER sync_bump_task_subcategory_ins AFTER INSERT ON task_subcategory BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;
CREATE TRIGGER sync_bump_task_subcategory_upd AFTER UPDATE ON task_subcategory BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;
CREATE TRIGGER sync_bump_task_subcategory_del AFTER DELETE ON task_subcategory BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;

CREATE TRIGGER sync_bump_task_tag_ins AFTER INSERT ON task_tag BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;
CREATE TRIGGER sync_bump_task_tag_del AFTER DELETE ON task_tag BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;

CREATE TRIGGER sync_bump_task_categories_ins AFTER INSERT ON task_categories BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;
CREATE TRIGGER sync_bump_task_categories_upd AFTER UPDATE ON task_categories BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;
CREATE TRIGGER sync_bump_task_categories_del AFTER DELETE ON task_categories BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;

CREATE TRIGGER sync_bump_task_subcategories_ins AFTER INSERT ON task_subcategories BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;
CREATE TRIGGER sync_bump_task_subcategories_upd AFTER UPDATE ON task_subcategories BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;
CREATE TRIGGER sync_bump_task_subcategories_del AFTER DELETE ON task_subcategories BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;

CREATE TRIGGER sync_bump_task_tags_ins AFTER INSERT ON task_tags BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;
CREATE TRIGGER sync_bump_task_tags_upd AFTER UPDATE ON task_tags BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;
CREATE TRIGGER sync_bump_task_tags_del AFTER DELETE ON task_tags BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;

CREATE TRIGGER sync_bump_task_blocks_ins AFTER INSERT ON task_blocks BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;
CREATE TRIGGER sync_bump_task_blocks_upd AFTER UPDATE ON task_blocks BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;
CREATE TRIGGER sync_bump_task_blocks_del AFTER DELETE ON task_blocks BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;

CREATE TRIGGER sync_bump_favorite_folder_ins AFTER INSERT ON favorite_folder BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;
CREATE TRIGGER sync_bump_favorite_folder_upd AFTER UPDATE ON favorite_folder BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;
CREATE TRIGGER sync_bump_favorite_folder_del AFTER DELETE ON favorite_folder BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;

CREATE TRIGGER sync_bump_app_settings_ins AFTER INSERT ON app_settings BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;
CREATE TRIGGER sync_bump_app_settings_upd AFTER UPDATE ON app_settings BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;
CREATE TRIGGER sync_bump_app_settings_del AFTER DELETE ON app_settings BEGIN
  UPDATE sync_meta SET value = datetime('now') WHERE key = 'data_revision';
END;
