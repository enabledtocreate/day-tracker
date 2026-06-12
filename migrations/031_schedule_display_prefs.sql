-- Schedule display: optional hide category/subcategory row and tags on time blocks.
INSERT INTO app_settings (key, value) VALUES ('schedule_hide_category_subcategory', '0')
  ON CONFLICT(key) DO NOTHING;
INSERT INTO app_settings (key, value) VALUES ('schedule_hide_tags', '0')
  ON CONFLICT(key) DO NOTHING;

INSERT INTO schema_migrations (filename) VALUES ('031_schedule_display_prefs.sql');
