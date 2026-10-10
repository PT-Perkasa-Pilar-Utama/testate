-- testate:foreign-keys-off
-- The Logs tier (#37, #69; docs/decisions/2026-10-10-logs-tier.md): adapters of kind 'logs' and
-- the six Logs engines. SQLite cannot alter a CHECK in place, so `adapters` is rebuilt.
--
-- Five tables reference `adapters` (column_policies, known_host_keys, normalizers, saved_queries,
-- write_sessions). The first line above has the runner switch foreign keys off for this file:
-- with them on, DROP TABLE would delete every row that points at an adapter. The runner checks
-- every reference afterwards and rolls back if one is broken. The children name `adapters`, so
-- they point at the rebuilt table once it takes the name.
--
-- The CHECKs also drop 'rest' and 'http', removed in 0002 with every row that used them.
CREATE TABLE adapters_new (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('database', 'storage', 'logs')),
  engine TEXT NOT NULL CHECK (engine IN (
    'postgres', 'mysql', 'mariadb', 'mongodb',
    's3', 'sftp', 'ftp',
    'logfile', 'ingest', 'journald', 'docker', 'loki', 'elasticsearch'
  )),
  name TEXT NOT NULL COLLATE NOCASE,
  mode TEXT NOT NULL DEFAULT 'sandbox' CHECK (mode IN ('sandbox', 'read_only')),
  config_public TEXT NOT NULL,
  config_sealed TEXT NOT NULL,
  readonly_config_sealed TEXT,
  excluded_tables TEXT NOT NULL DEFAULT '[]',
  restore_mode TEXT NOT NULL DEFAULT 'atomic' CHECK (restore_mode IN ('atomic', 'fast')),
  lock_timeout_ms INTEGER NOT NULL DEFAULT 60000,
  target_hash TEXT,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error', 'disabled')),
  status_message TEXT,
  engine_version TEXT,
  dialect TEXT,
  capabilities TEXT,
  strategy TEXT,
  read_only_enforcement TEXT,
  sealed_set_at TEXT,
  sealed_key_fingerprint TEXT,
  last_probe_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT REFERENCES users (id) ON DELETE SET NULL
);

INSERT INTO adapters_new (
  id, project_id, kind, engine, name, mode, config_public, config_sealed, readonly_config_sealed,
  excluded_tables, restore_mode, lock_timeout_ms, target_hash, status, status_message,
  engine_version, dialect, capabilities, strategy, read_only_enforcement, sealed_set_at,
  sealed_key_fingerprint, last_probe_at, created_at, updated_at, created_by
)
SELECT
  id, project_id, kind, engine, name, mode, config_public, config_sealed, readonly_config_sealed,
  excluded_tables, restore_mode, lock_timeout_ms, target_hash, status, status_message,
  engine_version, dialect, capabilities, strategy, read_only_enforcement, sealed_set_at,
  sealed_key_fingerprint, last_probe_at, created_at, updated_at, created_by
FROM adapters;

DROP TABLE adapters;
ALTER TABLE adapters_new RENAME TO adapters;

CREATE UNIQUE INDEX adapters_project_name ON adapters (project_id, name COLLATE NOCASE);
