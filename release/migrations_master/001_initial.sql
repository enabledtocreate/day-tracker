-- Day Tracker master DB: users, app-wide settings (admin), SSO links

CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  db_name TEXT NOT NULL UNIQUE,
  force_password_reset INTEGER NOT NULL DEFAULT 0,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS sso_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  master_user_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  email TEXT NOT NULL,
  sub TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider, sub)
);

INSERT OR IGNORE INTO app_settings (key, value) VALUES ('debug', '0'), ('ai_enabled', '1');

INSERT INTO schema_migrations (filename) VALUES ('001_initial.sql');
