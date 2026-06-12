-- Optional Lucide icon name (whitelist) per category and per schedule block type.

ALTER TABLE task_categories ADD COLUMN icon TEXT;
ALTER TABLE task_blocks ADD COLUMN icon TEXT;

INSERT INTO schema_migrations (filename) VALUES ('030_task_category_block_icons.sql');
