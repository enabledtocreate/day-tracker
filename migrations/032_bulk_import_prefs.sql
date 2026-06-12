-- Bulk import / quick add preferences (JSON blob).
INSERT INTO app_settings (key, value) VALUES ('bulk_import_json', '{"delimiter":"tab","allow_duplicates_quick_add":true,"add_new_values":true,"ignore_case":false,"instruction_text":"","columns_enabled":{"category":true,"subcategory":true,"tags":true,"priority":true,"due_date":true,"list":true,"recurring":true,"list_style":true,"links":true,"checklist":true,"category_color":true,"tag_colors":true}}')
  ON CONFLICT(key) DO NOTHING;

INSERT INTO schema_migrations (filename) VALUES ('032_bulk_import_prefs.sql');
