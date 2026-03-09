-- Set recurrence_rule to daily for any task with recurring=1 that has NULL or empty recurrence_rule.
-- Application should default new recurring tasks to daily (recurrence_rule = '{"freq":"daily","time":"09:00"}') when not provided.
UPDATE tasks
SET recurrence_rule = '{"freq":"daily","time":"09:00"}'
WHERE recurring = 1
  AND (recurrence_rule IS NULL OR trim(coalesce(recurrence_rule, '')) = '');

INSERT INTO schema_migrations (filename) VALUES ('012_recurring_default_daily.sql');
