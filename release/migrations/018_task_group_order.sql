-- Task groups ordering: stable order of children within a parent group.
-- Root tasks can ignore this; children will use group_order.
ALTER TABLE tasks ADD COLUMN group_order INTEGER NOT NULL DEFAULT 0;

INSERT INTO schema_migrations (filename) VALUES ('018_task_group_order.sql');

