-- Per-user session lifetime: days until auto-logout (0 = indefinite; default 30).

ALTER TABLE users ADD COLUMN session_lifetime_days INTEGER DEFAULT 30;

INSERT INTO schema_migrations (filename) VALUES ('002_session_lifetime_days.sql');
