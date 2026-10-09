import { describe, expect, it } from "bun:test";

import { TEST_META, createAccounts } from "../../../test/accounts.ts";
import type { AccountsHarness } from "../../../test/accounts.ts";
import { createJobsHarness } from "../../../test/jobs.ts";
import { createTestSettings } from "../../../test/settings.ts";
import { bootstrapWithInspect } from "../../wiring.store.ts";
import { createUsersRepository } from "../users/users.repository.ts";
import { ensureInspectProject } from "./projects.inspect.ts";
import { createProjectsService } from "./projects.service.ts";

// #56, Q2 (docs/decisions/2026-10-09-inspect-project.md): the built-in Inspect project.
const LIST = { limit: 50, sort: "name", order: "asc" } as const;
const SOME_PLAN = "01991f00-0000-7000-8000-000000000098";

function ensure(harness: AccountsHarness): boolean {
  const users = createUsersRepository(harness.db);
  return ensureInspectProject(harness.projectsRepo, () => users.firstAdminId(), harness.now);
}

function projectsOf(harness: AccountsHarness) {
  return createProjectsService({
    repo: harness.projectsRepo,
    audit: harness.audit,
    settings: createTestSettings(harness.db, harness.audit, harness.now),
    adapters: { list: async () => [] },
    jobs: createJobsHarness(harness.db, harness.now).jobs,
    now: harness.now,
  });
}

describe("the built-in Inspect project", () => {
  it("is created once, by the first admin, and found again by kind", async () => {
    const harness = await createAccounts();
    expect(ensure(harness)).toBe(true);
    expect(ensure(harness)).toBe(false);
    const inspect = harness.projectsRepo.byKind("inspect");
    expect(inspect).toMatchObject({ slug: "inspect", kind: "inspect", name: "Inspect" });
    expect(inspect?.created_by).toBe(harness.admin.id);
  });

  it("leaves an existing `inspect` project alone and takes the next slug", async () => {
    const harness = await createAccounts();
    harness.projectsRepo.insert({
      id: "01991f00-0000-7000-8000-000000000041",
      slug: "inspect",
      name: "Our own inspect",
      description: null,
      quota_bytes: null,
      created_by: harness.admin.id,
      created_at: harness.now().toISOString(),
    });
    ensure(harness);
    expect(harness.projectsRepo.bySlug("inspect")?.kind).toBe("standard");
    expect(harness.projectsRepo.byKind("inspect")?.slug).toBe("inspect-2");
  });

  it("waits for an admin rather than inventing a creator", async () => {
    const harness = await createAccounts();
    expect(ensureInspectProject(harness.projectsRepo, () => null, harness.now)).toBe(false);
    expect(harness.projectsRepo.byKind("inspect")).toBeNull();
  });

  it("the database holds at most one, whatever calls insert", async () => {
    const harness = await createAccounts();
    ensure(harness);
    expect(() =>
      harness.projectsRepo.insert({
        id: "01991f00-0000-7000-8000-000000000042",
        slug: "second-inspect",
        kind: "inspect",
        name: "Second",
        description: null,
        quota_bytes: null,
        created_by: harness.admin.id,
        created_at: harness.now().toISOString(),
      })
    ).toThrow("UNIQUE constraint failed");
  });

  it("comes back after reset-state's bootstrap", async () => {
    const harness = await createAccounts();
    const users = createUsersRepository(harness.db);
    const bootstrap = bootstrapWithInspect(
      async () => true,
      harness.db,
      () => users.firstAdminId()
    );
    await bootstrap?.();
    expect(harness.projectsRepo.byKind("inspect")).not.toBeNull();
    expect(bootstrapWithInspect(null, harness.db, () => null)).toBeNull();
  });

  it("the list can ask for one kind, and no new project takes the slug", async () => {
    const harness = await createAccounts();
    ensure(harness);
    const projects = projectsOf(harness);
    const made = await projects.create(harness.admin, { name: "Inspect" }, TEST_META);
    const standard = await projects.list(null, { ...LIST, kind: "standard" });
    const inspect = await projects.list(null, { ...LIST, kind: "inspect" });
    expect(made.slug).toBe("inspect-2");
    expect(standard.map((p) => p.slug)).toStrictEqual(["inspect-2"]);
    expect(inspect.map((p) => p.kind)).toStrictEqual(["inspect"]);
    await expect(
      projects.create(harness.admin, { name: "Mine", slug: "inspect" }, TEST_META)
    ).rejects.toMatchObject({ code: "CONFLICT" });
    // Reserved, though no project holds it: a route answers to `defaults`.
    await expect(
      projects.create(harness.admin, { name: "Defaults", slug: "defaults" }, TEST_META)
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("cannot be renamed, given a quota, or deleted, by anyone (Q7)", async () => {
    const harness = await createAccounts();
    ensure(harness);
    const projects = projectsOf(harness);
    const admin = harness.admin;
    const refused = { code: "PROJECT_READ_ONLY" };
    await expect(
      projects.update(admin, "inspect", { name: "Mine now" }, TEST_META)
    ).rejects.toMatchObject(refused);
    await expect(projects.deletionPlan("inspect")).rejects.toMatchObject(refused);
    const request = { confirm_slug: "inspect", plan_id: SOME_PLAN, adapters: [] };
    await expect(
      projects.deleteProject(admin, "inspect", request, TEST_META)
    ).rejects.toMatchObject(refused);
    expect(harness.projectsRepo.byKind("inspect")?.name).toBe("Inspect");
  });
});
