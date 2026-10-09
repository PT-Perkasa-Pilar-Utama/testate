-- Which projects a viewer or a tester may see and act on (#55, docs/decisions/2026-10-09-project-scope.md).
--
-- A token has carried a project scope from the start; a user never did, so every viewer and tester
-- reached every project. `all_projects` is the "every project" choice, and `user_projects` lists
-- the projects of a user who has a list instead. Keeping "every project" as a flag, not as the
-- absence of rows, leaves "no rows" one meaning: no projects at all.
--
-- The default of 1 is the upgrade: every user who exists before this migration keeps the access
-- they had, so nobody is locked out. A user created afterwards states the scope; the service writes
-- the flag explicitly. An admin always has every project, whatever these say.
ALTER TABLE users ADD COLUMN all_projects INTEGER NOT NULL DEFAULT 1;

-- Deleting a project or a user removes its rows (Q2, Q5): no cleanup pass, and a user whose last
-- project goes stays active with no projects.
CREATE TABLE user_projects (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, project_id)
);

CREATE INDEX user_projects_project ON user_projects (project_id);
