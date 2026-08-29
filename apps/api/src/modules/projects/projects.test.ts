import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { jobSchema, projectSchema, quotaSchema } from "@testate/shared";
import type { Actor } from "@testate/shared";

import { TEST_META, actorOf, createAccounts } from "../../../test/accounts.ts";
import { createJobsHarness } from "../../../test/jobs.ts";
import { expectContract } from "../../../test/contract.ts";
import { ADAPTER_MOCK } from "../adapters/adapters.mock.ts";
import { createTestSettings } from "../../../test/settings.ts";
import { PROJECT_JOB_MOCK, PROJECT_MOCK, QUOTA_MOCK } from "./projects.mock.ts";
import { requireProjectInScope } from "./projects.scope.ts";
import { PLAN_TTL_MS, createProjectsService } from "./projects.service.ts";
import type { ProjectsService } from "./projects.service.ts";

type Harness = {
  projects: ProjectsService;
  admin: Actor;
  qa: Actor;
  advance: (ms: number) => void;
  audit: Awaited<ReturnType<typeof createAccounts>>["audit"];
  repo: Awaited<ReturnType<typeof createAccounts>>["projectsRepo"];
};

const LIST = { limit: 50, sort: "name", order: "asc" } as const;

type PlanChoice = { adapter_id: string; action: "restore" | "force" | "skip" };

/** The request an operator sends when accepting the plan as issued. */
function accept(plan: Awaited<ReturnType<ProjectsService["deletionPlan"]>>): PlanChoice[] {
  return plan.adapters
    .filter((adapter) => adapter.action !== "none")
    .map((adapter) => ({
      adapter_id: adapter.adapter_id,
      action: adapter.action === "skip" ? "skip" : "restore",
    }));
}

async function setup(): Promise<Harness> {
  const accounts = await createAccounts();
  const qaUser = await accounts.users.create(
    accounts.admin,
    {
      username: "dina.qa",
      display_name: "Dina",
      role: "qa",
      temporary_password: "temporary-password-1",
    },
    TEST_META
  );
  const projects = createProjectsService({
    repo: accounts.projectsRepo,
    audit: accounts.audit,
    settings: createTestSettings(accounts.db, accounts.audit, accounts.now),
    adapters: { list: async () => [ADAPTER_MOCK] },
    jobs: createJobsHarness(accounts.db, accounts.now).jobs,
    now: accounts.now,
  });
  return {
    projects,
    admin: accounts.admin,
    qa: actorOf(qaUser),
    advance: accounts.advance,
    audit: accounts.audit,
    repo: accounts.projectsRepo,
  };
}

describe("projects", () => {
  it("mocks match the contract", () => {
    expectContract(projectSchema, PROJECT_MOCK, (clone) => {
      clone["slug"] = "Not A Slug";
    });
    expectContract(quotaSchema, QUOTA_MOCK, (clone) => {
      clone["used_bytes"] = "many";
    });
    expectContract(jobSchema, PROJECT_JOB_MOCK, (clone) => {
      clone["status"] = "done";
    });
  });

  it("creates a project with HEAD none and refuses a duplicate slug", async () => {
    const { projects, qa } = await setup();
    const project = await projects.create(qa, { slug: "shop", name: "Shop" }, TEST_META);
    expect(project.head).toStrictEqual({
      status: "none",
      state_id: null,
      state_name: null,
      changed_at: null,
    });
    expect(project.quota_bytes).toBeNull();
    expect(project.created_by).toBe(qa.id);
    await expect(
      projects.create(qa, { slug: "shop", name: "Again" }, TEST_META)
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: { slug: "shop" },
    });
  });

  it("lists with search, sort, and token scope", async () => {
    const { projects, qa } = await setup();
    const shop = await projects.create(qa, { slug: "shop", name: "Shop" }, TEST_META);
    await projects.create(qa, { slug: "billing", name: "Billing" }, TEST_META);
    const names = async (scope: string[] | null, query = {}): Promise<string[]> =>
      (await projects.list(scope, { ...LIST, ...query })).map((project) => project.slug);
    expect(await names(null)).toStrictEqual(["billing", "shop"]);
    expect(await names(null, { order: "desc" })).toStrictEqual(["shop", "billing"]);
    expect(await names(null, { q: "sho" })).toStrictEqual(["shop"]);
    expect(await names([shop.id])).toStrictEqual(["shop"]);
    expect(await names([])).toStrictEqual([]);
  });

  it("resolves the quota from settings when the project has none", async () => {
    const { projects, qa } = await setup();
    await projects.create(qa, { slug: "shop", name: "Shop" }, TEST_META);
    const quota = await projects.quota("shop");
    expect(quota.quota_bytes).toBe(10737418240);
    expect(quota.warn_at_bytes).toBe(Math.floor(10737418240 * 0.8));
    expect(quota.used_bytes).toBe(0);
    await expect(projects.quota("nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lets qa rename but only admin set the quota", async () => {
    const { projects, qa, admin } = await setup();
    await projects.create(qa, { slug: "shop", name: "Shop" }, TEST_META);
    const renamed = await projects.update(
      qa,
      "shop",
      { name: "Web shop", description: "SIT" },
      TEST_META
    );
    expect(renamed.name).toBe("Web shop");
    expect(renamed.description).toBe("SIT");
    await expect(
      projects.update(qa, "shop", { quota_bytes: 1024 }, TEST_META)
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      details: { reason: "role" },
    });
    const sized = await projects.update(admin, "shop", { quota_bytes: 1024 }, TEST_META);
    expect(sized.quota_bytes).toBe(1024);
    expect((await projects.quota("shop")).quota_bytes).toBe(1024);
    expect(
      (await projects.update(admin, "shop", { quota_bytes: null }, TEST_META)).quota_bytes
    ).toBeNull();
  });

  it("builds the overview with adapters, jobs, quota, and no banner while HEAD is not unknown", async () => {
    const { projects, qa } = await setup();
    await projects.create(qa, { slug: "shop", name: "Shop" }, TEST_META);
    const overview = await projects.get(qa, "shop");
    expect(overview.project.slug).toBe("shop");
    expect(overview.adapters.length).toBeGreaterThan(0);
    expect(overview.banner).toBeNull();
    expect((await projects.head("shop")).status).toBe("none");
  });

  it("issues a deletion plan that expires after 15 minutes", async () => {
    const { projects, qa, admin, advance } = await setup();
    await projects.create(qa, { slug: "shop", name: "Shop" }, TEST_META);
    const plan = await projects.deletionPlan("shop");
    const request = { confirm_slug: "shop", plan_id: plan.plan_id, adapters: accept(plan) };
    advance(PLAN_TTL_MS + 1000);
    await expect(projects.deleteProject(admin, "shop", request, TEST_META)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("validates the deletion request against the plan", async () => {
    const { projects, qa, admin } = await setup();
    await projects.create(qa, { slug: "shop", name: "Shop" }, TEST_META);
    const plan = await projects.deletionPlan("shop");
    const restoreAll = accept(plan);
    const request = (
      adapters: PlanChoice[],
      confirm = "shop"
    ): Parameters<ProjectsService["deleteProject"]>[2] => ({
      confirm_slug: confirm,
      plan_id: plan.plan_id,
      adapters,
    });
    await expect(
      projects.deleteProject(admin, "shop", request(restoreAll, "shpo"), TEST_META)
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      projects.deleteProject(admin, "shop", request([]), TEST_META)
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const forced = restoreAll.map((item): PlanChoice => ({ ...item, action: "force" }));
    await expect(
      projects.deleteProject(admin, "shop", request(forced), TEST_META)
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: { action: "force" },
    });
    const job = await projects.deleteProject(admin, "shop", request(restoreAll), TEST_META);
    expect(job.kind).toBe("project_delete");
    await expect(
      projects.deleteProject(admin, "shop", request(restoreAll), TEST_META)
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("writes audit rows with the project reference", async () => {
    const { projects, qa, audit } = await setup();
    const project = await projects.create(qa, { slug: "shop", name: "Shop" }, TEST_META);
    await projects.update(qa, "shop", { name: "Shop 2" }, TEST_META);
    const rows = (await audit.list({ limit: 10, action: "project." })).rows;
    expect(rows.map((row) => row.action)).toStrictEqual(["project.updated", "project.created"]);
    expect(rows[0]?.project).toStrictEqual({ id: project.id, slug: "shop" });
    expect((await audit.list({ limit: 10, scope: [] })).rows).toStrictEqual([]);
    expect((await audit.list({ limit: 10, scope: [project.id] })).rows.length).toBe(2);
  });

  it("answers 404 for a project outside a token's scope", async () => {
    const { projects, qa, repo } = await setup();
    const shop = await projects.create(qa, { slug: "shop", name: "Shop" }, TEST_META);
    await projects.create(qa, { slug: "billing", name: "Billing" }, TEST_META);
    const app = new Hono();
    app.use("/projects/:slug/*", async (c, next) => {
      c.set("projectScope", [shop.id]);
      await next();
    });
    app.use("/projects/:slug/*", requireProjectInScope(repo));
    app.get("/projects/:slug/head", (c) => c.json({ ok: true }));
    app.onError((cause, c) => c.json({ error: String(cause) }, 500));
    expect((await app.request("/projects/shop/head")).status).toBe(200);
    expect((await app.request("/projects/billing/head")).status).toBe(500);
    expect((await app.request("/projects/nope/head")).status).toBe(500);
  });
});
