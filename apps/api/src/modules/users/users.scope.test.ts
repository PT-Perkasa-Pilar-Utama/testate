import { describe, expect, it } from "bun:test";

import { TEST_META, createAccounts } from "../../../test/accounts.ts";
import type { AccountsHarness } from "../../../test/accounts.ts";
import { createUsersRepository } from "./users.repository.ts";

// #55, docs/decisions/2026-10-09-project-scope.md: which projects a viewer or a tester reaches.
const SHOP = "01991f00-0000-7000-8000-000000000021";
const CRM = "01991f00-0000-7000-8000-000000000022";
const PASSWORD = "temporary-password-1";

function addProject(harness: AccountsHarness, id: string, slug: string): void {
  harness.projectsRepo.insert({
    id,
    slug,
    name: slug,
    description: null,
    quota_bytes: null,
    created_by: harness.admin.id,
    created_at: harness.now().toISOString(),
  });
}

async function withProjects(): Promise<AccountsHarness> {
  const harness = await createAccounts();
  addProject(harness, SHOP, "shop");
  addProject(harness, CRM, "crm");
  return harness;
}

const viewer = (projectIds: string[] | null) =>
  ({
    username: "vera.viewer",
    display_name: "Vera",
    role: "viewer",
    temporary_password: PASSWORD,
    project_ids: projectIds,
  }) as const;

describe("a user's project scope", () => {
  it("a new viewer or tester is refused until someone chooses their projects", async () => {
    const { users, admin } = await withProjects();
    const { project_ids: _left, ...unscoped } = viewer(null);
    await expect(users.create(admin, unscoped, TEST_META)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: { field: "project_ids" },
    });
  });

  it("stores the projects chosen, or every project, and answers them back", async () => {
    const { users, admin } = await withProjects();
    const listed = await users.create(admin, viewer([SHOP]), TEST_META);
    const everything = await users.create(
      admin,
      { ...viewer(null), username: "evan.viewer" },
      TEST_META
    );
    const nothing = await users.create(
      admin,
      { ...viewer([]), username: "nina.viewer" },
      TEST_META
    );
    expect(listed.project_ids).toEqual([SHOP]);
    expect(everything.project_ids).toBeNull();
    expect(nothing.project_ids).toEqual([]);
  });

  it("an admin has every project, whatever scope is sent", async () => {
    const { users, admin } = await withProjects();
    const created = await users.create(
      admin,
      { ...viewer([SHOP]), username: "ada.admin", role: "admin" },
      TEST_META
    );
    expect(created.project_ids).toBeNull();
  });

  it("refuses an unknown project and leaves no half-made account behind", async () => {
    const { users, admin, db } = await withProjects();
    const unknown = "01991f00-0000-7000-8000-0000000000ff";
    await expect(users.create(admin, viewer([unknown]), TEST_META)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(createUsersRepository(db).byUsername("vera.viewer")).toBeNull();
  });

  it("demoting an admin must say which projects they keep", async () => {
    const { users, admin } = await withProjects();
    const second = await users.create(
      admin,
      { ...viewer(null), username: "sam.admin", role: "admin" },
      TEST_META
    );
    await expect(users.update(admin, second.id, { role: "qa" }, TEST_META)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: { field: "project_ids" },
    });
    const demoted = await users.update(
      admin,
      second.id,
      { role: "qa", project_ids: [CRM] },
      TEST_META
    );
    expect(demoted.role).toBe("qa");
    expect(demoted.project_ids).toEqual([CRM]);
  });

  it("an edit that leaves the scope out leaves it as it was", async () => {
    const { users, admin } = await withProjects();
    const created = await users.create(admin, viewer([SHOP]), TEST_META);
    const renamed = await users.update(admin, created.id, { display_name: "Vera P" }, TEST_META);
    const promoted = await users.update(admin, created.id, { role: "qa" }, TEST_META);
    expect(renamed.project_ids).toEqual([SHOP]);
    expect(promoted.project_ids).toEqual([SHOP]);
  });

  it("deleting a project takes it out of the scope, and the user stays active", async () => {
    const { users, admin, db } = await withProjects();
    const created = await users.create(admin, viewer([SHOP, CRM]), TEST_META);
    db.query("DELETE FROM projects WHERE id = ?").run(SHOP);
    expect((await users.get(created.id)).project_ids).toEqual([CRM]);
    db.query("DELETE FROM projects WHERE id = ?").run(CRM);
    const left = await users.get(created.id);
    expect(left.project_ids).toEqual([]);
    expect(left.disabled_at).toBeNull();
  });

  it("a user who existed before scopes keeps every project", async () => {
    const { db } = await withProjects();
    const repo = createUsersRepository(db);
    // A row written the way it was before migration 0009: no scope stated at all.
    const legacy = repo.insert({
      id: "01991f00-0000-7000-8000-000000000031",
      username: "old.viewer",
      display_name: "Old",
      role: "viewer",
      password_hash: "unused",
      must_change_password: false,
      created_at: new Date(0).toISOString(),
    });
    expect(legacy.project_ids).toBeNull();
  });

  it("a session carries the user's scope, and an admin's stays every project", async () => {
    const { users, admin, auth } = await withProjects();
    await users.create(admin, viewer([CRM]), TEST_META);
    const session = await auth.login({ username: "vera.viewer", password: PASSWORD }, TEST_META);
    const resolved = await auth.fromSession(session.sessionToken);
    const adminSession = await auth.login(
      { username: "admin", password: "bootstrap-admin-secret" },
      TEST_META
    );
    expect(resolved?.projectScope).toEqual([CRM]);
    expect((await auth.fromSession(adminSession.sessionToken))?.projectScope).toBeNull();
  });
});
