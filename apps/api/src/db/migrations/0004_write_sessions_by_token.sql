-- A write session can now belong to an agent token, not only to a person (23 §23.6).
--
-- `user_id` carried a foreign key into `users`, and a token actor's id is a token id, so an agent
-- could never own a session and therefore could never write. Two nullable columns with a check
-- keep the referential integrity a single untyped `owner_id` would have thrown away: exactly one
-- of them is set, and both still point at a row that exists.
--
-- SQLite cannot drop a NOT NULL or add a CHECK in place, so the table is rebuilt. Nothing
-- references `write_sessions`, and it has no indexes, which is what makes that cheap here.
CREATE TABLE write_sessions_new (
  id TEXT PRIMARY KEY,
  adapter_id TEXT NOT NULL REFERENCES adapters (id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users (id),
  token_id TEXT REFERENCES api_tokens (id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  last_write_at TEXT,
  ended_at TEXT,
  stash_state_id TEXT,
  write_count INTEGER NOT NULL DEFAULT 0,
  foreign_key_checks INTEGER NOT NULL DEFAULT 1,
  CHECK ((user_id IS NULL) <> (token_id IS NULL))
);

INSERT INTO write_sessions_new (
  id, adapter_id, user_id, token_id, started_at, last_write_at, ended_at, stash_state_id,
  write_count, foreign_key_checks
)
SELECT
  id, adapter_id, user_id, NULL, started_at, last_write_at, ended_at, stash_state_id,
  write_count, foreign_key_checks
FROM write_sessions;

DROP TABLE write_sessions;
ALTER TABLE write_sessions_new RENAME TO write_sessions;
