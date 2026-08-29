-- Testate metadata schema, v1. See docs/technical-specs/06-data-model.md.
-- Ids are UUID v7 text. Timestamps are ISO-8601 UTC text. Booleans are 0/1.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'qa', 'viewer')),
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  disabled_at TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX users_username ON users (username COLLATE NOCASE);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  ip TEXT,
  user_agent TEXT,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'qa', 'viewer')),
  kind TEXT NOT NULL DEFAULT 'standard' CHECK (kind IN ('standard', 'agent')),
  project_ids TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  created_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  last_used_at TEXT,
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  quota_bytes INTEGER,
  head_state_id TEXT,
  head_status TEXT NOT NULL DEFAULT 'none' CHECK (head_status IN ('none', 'at_state', 'unknown')),
  head_changed_at TEXT,
  created_by TEXT NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE adapters (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('database', 'storage', 'rest')),
  engine TEXT NOT NULL CHECK (engine IN ('postgres', 'mysql', 'mariadb', 'mongodb', 's3', 'sftp', 'ftp', 'http')),
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
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX adapters_project_name ON adapters (project_id, name COLLATE NOCASE);

CREATE TABLE known_host_keys (
  id TEXT PRIMARY KEY,
  adapter_id TEXT NOT NULL REFERENCES adapters (id) ON DELETE CASCADE,
  key_type TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  accepted_by TEXT NOT NULL REFERENCES users (id),
  accepted_at TEXT NOT NULL
);

CREATE TABLE column_policies (
  id TEXT PRIMARY KEY,
  adapter_id TEXT NOT NULL REFERENCES adapters (id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  column_name TEXT NOT NULL,
  required_function TEXT,
  mask TEXT CHECK (mask IN ('redact', 'partial', 'hash')),
  display INTEGER NOT NULL DEFAULT 0,
  locked INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (adapter_id, table_name, column_name)
);

CREATE TABLE states (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,
  kind TEXT NOT NULL CHECK (kind IN ('init', 'manual', 'stash', 'diff')),
  status TEXT NOT NULL DEFAULT 'creating' CHECK (status IN ('creating', 'ready', 'failed')),
  protected INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  parent_state_id TEXT REFERENCES states (id) ON DELETE SET NULL,
  stash_reason TEXT CHECK (stash_reason IN ('checkout', 'import', 'write-session')),
  owner_diff_id TEXT,
  job_id TEXT NOT NULL,
  actor_user_id TEXT,
  actor_token_id TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX states_project_name ON states (project_id, name COLLATE NOCASE);
CREATE INDEX states_project_kind ON states (project_id, kind);

CREATE TABLE state_adapters (
  state_id TEXT NOT NULL REFERENCES states (id) ON DELETE CASCADE,
  adapter_id TEXT NOT NULL,
  adapter_name TEXT NOT NULL,
  engine TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  consistency TEXT NOT NULL CHECK (consistency IN ('snapshot', 'best_effort')),
  removed INTEGER NOT NULL DEFAULT 0,
  tables TEXT NOT NULL,
  introspection TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  byte_count INTEGER NOT NULL,
  warnings TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (state_id, adapter_id)
);

CREATE TABLE blobs (
  hash TEXT PRIMARY KEY,
  size_bytes INTEGER NOT NULL,
  ref_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE state_blobs (
  state_id TEXT NOT NULL REFERENCES states (id) ON DELETE CASCADE,
  blob_hash TEXT NOT NULL REFERENCES blobs (hash),
  PRIMARY KEY (state_id, blob_hash)
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  adapter_ids TEXT NOT NULL DEFAULT '[]',
  kind TEXT NOT NULL CHECK (kind IN ('snapshot', 'checkout', 'import', 'diff', 'state_delete', 'adapter_delete', 'project_delete', 'archive_import', 'storage_migration', 'backup')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'partial', 'interrupted')),
  payload TEXT NOT NULL,
  result TEXT,
  error TEXT,
  progress TEXT,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  parent_request_id TEXT,
  actor TEXT NOT NULL DEFAULT '{}',
  actor_user_id TEXT,
  actor_token_id TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX jobs_status_created ON jobs (status, created_at);
CREATE INDEX jobs_project ON jobs (project_id, created_at);

CREATE TABLE blob_pins (
  blob_hash TEXT NOT NULL REFERENCES blobs (hash),
  job_id TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  PRIMARY KEY (blob_hash, job_id)
);

CREATE TABLE idempotency_keys (
  key_hash TEXT NOT NULL,
  token_id TEXT NOT NULL,
  job_id TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  body_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (key_hash, token_id)
);

CREATE TABLE checkouts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  state_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  stash_state_id TEXT,
  force INTEGER NOT NULL DEFAULT 0,
  purpose TEXT NOT NULL DEFAULT 'checkout' CHECK (purpose IN ('checkout', 'return_to_init')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'partial', 'failed', 'cancelled', 'interrupted')),
  actor_user_id TEXT,
  actor_token_id TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX checkouts_project ON checkouts (project_id, created_at);

CREATE TABLE checkout_adapters (
  checkout_id TEXT NOT NULL REFERENCES checkouts (id) ON DELETE CASCADE,
  adapter_id TEXT NOT NULL,
  result TEXT NOT NULL DEFAULT 'pending' CHECK (result IN ('pending', 'restored', 'skipped', 'rolled_back', 'unknown', 'counters_failed')),
  strategy TEXT,
  rows INTEGER,
  duration_ms INTEGER,
  lock_wait_ms INTEGER,
  skipped_tables TEXT NOT NULL DEFAULT '[]',
  skipped_columns TEXT NOT NULL DEFAULT '[]',
  defaulted_columns TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  PRIMARY KEY (checkout_id, adapter_id)
);

CREATE TABLE diffs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  base_state_id TEXT NOT NULL,
  target_state_id TEXT,
  live_state_id TEXT,
  job_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ready', 'failed')),
  summary TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE diff_tables (
  diff_id TEXT NOT NULL REFERENCES diffs (id) ON DELETE CASCADE,
  adapter_id TEXT NOT NULL,
  schema_name TEXT,
  table_name TEXT NOT NULL,
  added INTEGER NOT NULL DEFAULT 0,
  removed INTEGER NOT NULL DEFAULT 0,
  changed INTEGER NOT NULL DEFAULT 0,
  compare TEXT NOT NULL CHECK (compare IN ('primary-key', 'row-hash')),
  blob_hash TEXT REFERENCES blobs (hash),
  PRIMARY KEY (diff_id, adapter_id, table_name)
);

CREATE TABLE import_mappings (
  id TEXT PRIMARY KEY,
  adapter_id TEXT NOT NULL REFERENCES adapters (id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,
  target TEXT NOT NULL,
  columns TEXT NOT NULL,
  key_columns TEXT NOT NULL DEFAULT '[]',
  mode TEXT NOT NULL DEFAULT 'append' CHECK (mode IN ('append', 'upsert', 'replace')),
  options TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX import_mappings_adapter_name ON import_mappings (adapter_id, name COLLATE NOCASE);

CREATE TABLE import_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  adapter_id TEXT NOT NULL,
  mapping_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('upload', 'storage', 'rejected')),
  source_ref TEXT NOT NULL,
  dry_run INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL,
  stash_state_id TEXT,
  counts TEXT,
  rejected_path TEXT,
  actor_user_id TEXT,
  actor_token_id TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE saved_queries (
  id TEXT PRIMARY KEY,
  adapter_id TEXT NOT NULL REFERENCES adapters (id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,
  body TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX saved_queries_adapter_name ON saved_queries (adapter_id, name COLLATE NOCASE);

CREATE TABLE query_history (
  id TEXT PRIMARY KEY,
  adapter_id TEXT NOT NULL,
  user_id TEXT,
  token_id TEXT,
  query_hash TEXT NOT NULL,
  query_text TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('read', 'write')),
  duration_ms INTEGER,
  row_count INTEGER,
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX query_history_adapter ON query_history (adapter_id, created_at);

CREATE TABLE write_sessions (
  id TEXT PRIMARY KEY,
  adapter_id TEXT NOT NULL REFERENCES adapters (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id),
  started_at TEXT NOT NULL,
  last_write_at TEXT,
  ended_at TEXT,
  stash_state_id TEXT,
  write_count INTEGER NOT NULL DEFAULT 0,
  foreign_key_checks INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE rest_requests (
  id TEXT PRIMARY KEY,
  adapter_id TEXT NOT NULL REFERENCES adapters (id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,
  method TEXT NOT NULL CHECK (method IN ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')),
  path TEXT NOT NULL,
  query TEXT NOT NULL DEFAULT '{}',
  headers TEXT NOT NULL DEFAULT '{}',
  headers_sealed TEXT,
  body TEXT,
  expected_status INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX rest_requests_adapter_name ON rest_requests (adapter_id, name COLLATE NOCASE);

CREATE TABLE rest_request_runs (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES rest_requests (id) ON DELETE CASCADE,
  job_id TEXT,
  hook_run_id TEXT,
  status_code INTEGER,
  duration_ms INTEGER,
  response_headers TEXT,
  response_body TEXT,
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE hooks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  trigger TEXT NOT NULL CHECK (trigger IN ('before_checkout', 'after_checkout', 'after_snapshot', 'after_import')),
  rest_request_id TEXT NOT NULL REFERENCES rest_requests (id),
  position INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  fail_policy TEXT NOT NULL DEFAULT 'continue' CHECK (fail_policy IN ('abort', 'continue')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE hook_runs (
  id TEXT PRIMARY KEY,
  hook_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  request_run_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed', 'skipped')),
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  actor_token_id TEXT,
  actor_label TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  project_id TEXT,
  project_slug TEXT,
  adapter_id TEXT,
  adapter_name TEXT,
  details TEXT NOT NULL DEFAULT '{}',
  outcome TEXT CHECK (outcome IN ('succeeded', 'failed', 'partial')),
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX audit_logs_created ON audit_logs (created_at);
CREATE INDEX audit_logs_project ON audit_logs (project_id, created_at);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);
