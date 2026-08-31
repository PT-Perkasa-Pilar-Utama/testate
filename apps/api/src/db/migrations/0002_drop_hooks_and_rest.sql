-- Hooks and saved REST requests were removed in the beta UI rework (docs/UI_REWORK.md).
-- Hooks fired a saved HTTP request around a checkout, a snapshot, or an import. Nobody used it.
-- Saved REST requests existed almost entirely so hooks had something to point at: the `hooks`
-- table carried a foreign key into `rest_requests`, so one could not go without the other.
--
-- Dropped rather than left in place: an unused table with a foreign key still constrains deletes,
-- and a schema that describes features the code no longer has misleads whoever reads it next.
-- Adapters of kind 'rest' go with them; no other kind referenced those tables.
DROP TABLE IF EXISTS hook_runs;
DROP TABLE IF EXISTS hooks;
DROP TABLE IF EXISTS rest_request_runs;
DROP TABLE IF EXISTS rest_requests;
DELETE FROM adapters WHERE kind = 'rest';

-- The CHECK constraints on `adapters.kind` and `adapters.engine` in 0001 still admit 'rest' and
-- 'http'. SQLite cannot alter a CHECK without rebuilding the table, and `adapters` is referenced by
-- eight others. A permissive CHECK costs nothing here: valibot parses every adapter at the trust
-- boundary and the two values no longer exist in `ADAPTER_KINDS` or `ENGINES`.
