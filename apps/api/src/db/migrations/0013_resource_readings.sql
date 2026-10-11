-- Resource readings (#38, Q6 of docs/decisions/2026-10-11-resource-readings.md).
--
-- One row per reading across a project: each adapter's values and what was unavailable, as JSON.
-- The actor is copied as the audit log copies it, so a reading outlives the user or the token.
-- Swept after `retention.job_history_days`.
CREATE TABLE resource_readings (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'token')),
  actor_id TEXT NOT NULL,
  actor_label TEXT NOT NULL,
  body TEXT NOT NULL,
  taken_at TEXT NOT NULL
);

CREATE INDEX resource_readings_project ON resource_readings (project_id, taken_at);
