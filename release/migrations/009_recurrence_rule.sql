-- Add recurrence_rule for detailed recurring config (JSON: {freq, time?, days?, monthDays?, lastDayOfMonth?})
ALTER TABLE tasks ADD COLUMN recurrence_rule TEXT;

INSERT INTO schema_migrations (filename) VALUES ('009_recurrence_rule.sql');
