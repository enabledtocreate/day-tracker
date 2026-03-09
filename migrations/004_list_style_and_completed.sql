-- list_style on tasks (bullet | checklist); completed on list items for checklist mode

ALTER TABLE tasks ADD COLUMN list_style TEXT NOT NULL DEFAULT 'bullet';

ALTER TABLE task_list_items ADD COLUMN completed INTEGER NOT NULL DEFAULT 0;

INSERT INTO schema_migrations (filename) VALUES ('004_list_style_and_completed.sql');
