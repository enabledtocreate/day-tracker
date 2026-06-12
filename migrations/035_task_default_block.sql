-- Default schedule block type and duration (in schedule increment steps) for Auto Block.
ALTER TABLE tasks ADD COLUMN default_block_id INTEGER REFERENCES task_blocks(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN default_duration_intervals INTEGER NOT NULL DEFAULT 1;

INSERT INTO schema_migrations (filename) VALUES ('035_task_default_block.sql');
