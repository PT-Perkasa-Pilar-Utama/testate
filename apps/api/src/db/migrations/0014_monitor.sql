-- The monitor (#101, docs/decisions/2026-10-11-monitor.md).
--
-- A poller now takes a reading of every project on an interval, as Testate itself, so a reading
-- has a `source` and its actor may be `system`. SQLite cannot widen a CHECK in place, so the
-- table is rebuilt. Nothing references `resource_readings`. Polled rows are swept after
-- `retention.monitor_days`, manual ones after `retention.job_history_days`.
CREATE TABLE resource_readings_new (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'poll')),
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'token', 'system')),
  actor_id TEXT,
  actor_label TEXT NOT NULL,
  body TEXT NOT NULL,
  taken_at TEXT NOT NULL,
  CHECK ((actor_kind = 'system') = (actor_id IS NULL))
);

INSERT INTO resource_readings_new (
  id, project_id, source, actor_kind, actor_id, actor_label, body, taken_at
)
SELECT id, project_id, 'manual', actor_kind, actor_id, actor_label, body, taken_at
FROM resource_readings;

DROP TABLE resource_readings;
ALTER TABLE resource_readings_new RENAME TO resource_readings;

CREATE INDEX resource_readings_project ON resource_readings (project_id, taken_at);
CREATE INDEX resource_readings_sweep ON resource_readings (source, taken_at);
