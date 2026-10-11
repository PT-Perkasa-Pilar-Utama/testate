import { expect, test } from "bun:test";
import initSqlJs from "sql.js";

import { Database, useSqlite } from "./sqlite.ts";
import { migrate } from "../../../api/src/lib/db/index.ts";
import { createProjectsRepository } from "../../../api/src/modules/projects/projects.repository.ts";

test("the API's migrations, a repository and a rollback run on the sql.js shim", async () => {
  useSqlite(await initSqlJs());
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  // SAFETY: the API types its database as bun:sqlite; the shim implements the surface the repositories use.
  const report = migrate(db as never);
  expect(report.applied.length).toBe(13);
  const users = db.query(
    "INSERT INTO users (id, username, display_name, password_hash, role, must_change_password, created_at, updated_at) VALUES (?1, 'admin', 'Admin', 'x', 'admin', 0, ?2, ?2)"
  );
  users.run("01991f00-0000-7000-8000-000000000001", new Date().toISOString());
  // SAFETY: as above.
  const projects = createProjectsRepository(db as never);
  projects.insert({
    id: "01991f00-0000-7000-8000-000000000010",
    slug: "shop",
    name: "Shop",
    description: null,
    quota_bytes: null,
    created_by: "01991f00-0000-7000-8000-000000000001",
    created_at: new Date().toISOString(),
  });
  expect(projects.bySlug("shop")?.name).toBe("Shop");
  const tx = db.transaction(() => {
    db.query("UPDATE projects SET name = 'X'").run();
    throw new Error("rollback");
  });
  expect(() => tx()).toThrow("rollback");
  expect(projects.bySlug("shop")?.name).toBe("Shop");
});
