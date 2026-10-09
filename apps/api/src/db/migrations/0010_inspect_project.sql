-- The built-in Inspect project and who added each adapter (#56, docs/decisions/2026-10-09-inspect-project.md).
--
-- `kind` tells the one Inspect project from every project people make. Inspect holds read-only
-- adapters and nothing else, and code checks the kind rather than the slug, because an install
-- that already has its own `inspect` project keeps that slug and Inspect takes `inspect-2`.
--
-- The row itself is not inserted here. `projects.created_by` must name a user, and the migrations
-- run before the bootstrap admin exists, so boot and reset-state create it right after the admin.
ALTER TABLE projects ADD COLUMN kind TEXT NOT NULL DEFAULT 'standard'
  CHECK (kind IN ('standard', 'inspect'));

-- At most one Inspect project, whatever the boot step does.
CREATE UNIQUE INDEX projects_one_inspect ON projects (kind) WHERE kind = 'inspect';

-- Who added the adapter. In Inspect only its creator or an admin may change or remove it (Q3b).
-- Adapters from before this migration have no creator, and neither does one whose creator was
-- deleted: those are an admin's to change.
ALTER TABLE adapters ADD COLUMN created_by TEXT REFERENCES users (id) ON DELETE SET NULL;
