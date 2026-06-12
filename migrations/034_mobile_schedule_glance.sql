-- Mobile-only "Glance View" for the schedule (simplified, read-only by default).
-- See `.apm/_WORKSPACE/TODO-mobile.md §0.6 / §0.9 Step 7` for the full spec.
-- Stored as a string '0' / '1' to match the existing app_settings boolean style.

INSERT INTO app_settings (key, value) VALUES ('mobile_schedule_glance', '0')
  ON CONFLICT(key) DO NOTHING;

INSERT INTO schema_migrations (filename) VALUES ('034_mobile_schedule_glance.sql');
