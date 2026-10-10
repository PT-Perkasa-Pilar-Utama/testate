-- The `ingest` log engine's tokens (#75, I1 of docs/decisions/2026-10-10-logs-tier.md).
--
-- One active token per ingest adapter, SHA-256 stored, never on the Tokens screen. A token here
-- can push lines to its adapter and nothing else, which is why it is not a third `api_tokens`
-- kind: that table's tokens resolve to an actor and reach the API.
CREATE TABLE ingest_tokens (
  adapter_id TEXT PRIMARY KEY REFERENCES adapters (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
