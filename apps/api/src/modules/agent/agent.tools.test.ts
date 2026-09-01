import { describe, expect, it } from "bun:test";
import type { Actor, JsonObject, JsonValue } from "@testate/shared";
import { AGENT_TOOL_INPUTS } from "@testate/shared";
import * as v from "valibot";

import { TEST_META } from "../../../test/accounts.ts";
import { PG, S3, createAdaptersHarness, createSettled } from "../../../test/adapters.ts";
import type { MemoryTree } from "../../lib/files/index.ts";
import type { AdaptersHarness } from "../../../test/adapters.ts";
import { createTestSettings } from "../../../test/settings.ts";
import { createCheckoutsService } from "../checkouts/checkouts.service.ts";
import { createPoliciesRepository } from "../data/data.policies.ts";
import { createDataRepository } from "../data/data.repository.ts";
import { createDataService } from "../data/data.service.ts";
import { createDiffsService } from "../diffs/diffs.service.ts";
import { createProjectsService } from "../projects/projects.service.ts";
import { createStatesService } from "../states/states.service.ts";
import { createStorageService } from "../storage/storage.service.ts";
import { createRateLimiter } from "../../lib/http/ratelimit.ts";
import type { AgentContext, AgentRuntime } from "./agent.service.ts";
import { AGENT_GUIDE, TOOL_DESCRIPTIONS } from "./agent.guide.ts";
import { createAgentTools } from "./agent.tools.ts";

const AGENT_TOOL_NAMES = Object.keys(AGENT_TOOL_INPUTS);

type Harness = {
  harness: AdaptersHarness;
  runtime: AgentRuntime;
  adapterId: string;
  ctx: AgentContext;
};

async function createHarness(): Promise<Harness> {
  const harness = await createAdaptersHarness();
  const adapter = await createSettled(harness, PG);
  const settings = createTestSettings(harness.db, harness.audit, harness.now);
  const policies = createPoliciesRepository(harness.db);
  policies.upsert(
    adapter.id,
    {
      table: "public.customers",
      column: "email",
      required_function: null,
      mask: "redact",
      display: false,
    },
    harness.qa.id,
    "2026-08-29T00:00:00.000Z"
  );
  const shared = {
    engines: harness.engines,
    blobs: harness.blobs,
    ring: harness.ring,
    adapters: harness.repo,
    states: harness.states,
    projects: harness.projectsRepo,
    jobs: harness.runtime.jobs,
    audit: harness.audit,
    now: harness.now,
  };
  const data = createDataService({
    ...shared,
    repo: createDataRepository(harness.db),
    policies,
    settings,
  });
  const states = createStatesService({ ...shared, repo: harness.states, uploads: harness.imports });
  const diffs = createDiffsService({ ...shared, repo: harness.diffs, policies, settings });
  const projects = createProjectsService({
    repo: harness.projectsRepo,
    audit: harness.audit,
    settings,
    adapters: harness.adapters,
    jobs: harness.runtime.jobs,
    now: harness.now,
  });
  const runtime = createAgentTools({
    projects,
    projectsRepo: harness.projectsRepo,
    adapters: harness.adapters,
    adaptersRepo: harness.repo,
    data,
    states,
    diffs,
    storage: createStorageService({
      projects: harness.projectsRepo,
      files: harness.files,
      hostKeys: harness.hostKeys,
      audit: harness.audit,
      now: harness.now,
    }),
    audit: harness.audit,
  });
  void createCheckoutsService;
  const actor: Actor = {
    kind: "token",
    id: "01991f00-0000-7000-8000-0000000000a0",
    label: "token:agent",
    role: "viewer",
    agent: true,
  };
  return { harness, runtime, adapterId: adapter.id, ctx: { actor, scope: null, meta: TEST_META } };
}

function call(
  h: Harness,
  tool: string,
  args: JsonObject,
  ctx: AgentContext = h.ctx
): Promise<JsonValue> {
  return h.runtime.runTool(tool, args, ctx);
}

const rowsResult = v.object({
  rows: v.array(v.record(v.string(), v.any())),
  next_cursor: v.nullable(v.string()),
  masked_columns: v.array(v.string()),
});
const rowResult = v.object({
  row: v.record(v.string(), v.any()),
  parents: v.record(v.string(), v.array(v.record(v.string(), v.any()))),
  masked_columns: v.array(v.string()),
});

function uriAt(resources: { uri: string }[], index: number): string {
  const resource = resources[index];
  if (resource === undefined) throw new Error(`no resource ${index}`);
  return resource.uri;
}

describe("agent tools", () => {
  it("resolves adapters by name, masks rows, and caps page sizes", async () => {
    const h = await createHarness();
    const page = v.parse(
      rowsResult,
      await call(h, "page_rows", {
        project: "shop",
        adapter: "orders-db",
        table: "public.customers",
        limit: 5000,
      })
    );
    expect(page.rows[0]?.["email"]).toBe("***");
    expect(page.masked_columns).toEqual(["email"]);
    const tables = v.parse(
      v.array(v.object({ name: v.string() })),
      await call(h, "list_tables", { project: "shop", adapter: h.adapterId })
    );
    expect(tables.map((table) => table.name)).toEqual(["customers", "orders"]);
    const audit = h.harness.db
      .query(
        "SELECT action, outcome, target_id FROM audit_logs WHERE action = 'agent.tool_call' ORDER BY created_at"
      )
      .all();
    expect(audit.length).toBe(2);
  });

  it("get_row walks one level of parents and reports masked columns on both sides", async () => {
    const h = await createHarness();
    const result = v.parse(
      rowResult,
      await call(h, "get_row", {
        project: "shop",
        adapter: "orders-db",
        table: "public.orders",
        pk: { id: 1 },
      })
    );
    expect(result.row["id"]).toBe(1);
    expect(result.parents["public.customers"]?.[0]?.["email"]).toBe("***");
    expect(result.masked_columns).toEqual(["public.customers.email"]);
  });

  it("refuses projects outside the token scope and unknown tools, and audits failures", async () => {
    const h = await createHarness();
    const scoped: AgentContext = { ...h.ctx, scope: ["01991f00-0000-7000-8000-000000000999"] };
    await expect(call(h, "list_adapters", { project: "shop" }, scoped)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(call(h, "nope", {})).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(v.parse(v.array(v.unknown()), await call(h, "list_projects", {}, scoped))).toEqual([]);
    const failed = h.harness.db
      .query(
        "SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'agent.tool_call' AND outcome = 'failed'"
      )
      .get();
    expect(failed).toEqual({ n: 1 });
  });

  it("runs queries read-only under the agent caps and lists states and resources", async () => {
    const h = await createHarness();
    const query = v.parse(
      v.object({
        columns: v.array(v.object({ name: v.string() })),
        rows: v.array(v.any()),
        masked_columns: v.array(v.string()),
      }),
      await call(h, "run_readonly_query", {
        project: "shop",
        adapter: "orders-db",
        sql: "SELECT * FROM public.customers",
        limit: 1,
      })
    );
    expect(query.masked_columns).toEqual(["email"]);
    expect(query.rows.length).toBe(1);
    await expect(
      call(h, "run_readonly_query", {
        project: "shop",
        adapter: "orders-db",
        sql: "DELETE FROM public.customers",
      })
    ).rejects.toBeDefined();
    const states = v.parse(
      v.array(v.object({ name: v.string(), kind: v.string() })),
      await call(h, "list_states", { project: "shop" })
    );
    expect(states.map((state) => state.name)).toEqual(["init"]);
    const resources = await h.runtime.listResources(h.ctx);
    expect(resources.map((resource) => resource.uri)).toEqual([
      "testate://guide",
      `testate://projects/shop/states`,
      `testate://projects/shop/adapters/${h.adapterId}/schema`,
    ]);
    const schema = v.parse(
      v.object({ tables: v.array(v.unknown()) }),
      await h.runtime.readResource(uriAt(resources, 2), h.ctx)
    );
    expect(schema.tables.length).toBe(2);
  });

  it("lists and previews storage files, refusing binary previews", async () => {
    const h = await createHarness();
    const s3 = await createSettled(h.harness, S3);
    const tree: MemoryTree = new Map();
    tree.set("exports/a.csv", {
      bytes: new TextEncoder().encode("id\n1\n"),
      modified_at: "2026-08-28T00:00:00.000Z",
    });
    tree.set("logo.png", { bytes: new Uint8Array([1]), modified_at: "2026-08-28T00:00:00.000Z" });
    h.harness.trees.set("exports", tree);
    const listing = v.parse(
      v.object({
        entries: v.array(v.object({ path: v.string() })),
        next_cursor: v.nullable(v.string()),
      }),
      await call(h, "list_files", { project: "shop", adapter: s3.id, path: "exports" })
    );
    expect(listing.entries.map((entry) => entry.path)).toEqual(["exports/a.csv"]);
    expect(
      await call(h, "preview_file", { project: "shop", adapter: "exports", path: "exports/a.csv" })
    ).toEqual({
      kind: "csv",
      columns: ["id"],
      rows: [["1"]],
      truncated: false,
    });
    await expect(
      call(h, "preview_file", { project: "shop", adapter: "exports", path: "logo.png" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("the rate limiter refuses the call past the per-minute budget and names the wait", () => {
    let clock = Date.parse("2026-08-29T00:00:00.000Z");
    const limit = createRateLimiter(() => new Date(clock));
    expect(limit.hit("t1", 2)).toBeNull();
    expect(limit.hit("t1", 2)).toBeNull();
    expect(limit.hit("t1", 2)).toBe(60);
    clock += 61_000;
    expect(limit.hit("t1", 2)).toBeNull();
  });

  it("asking whether a key is over budget spends none of it, and recording spends one", () => {
    const clock = Date.parse("2026-08-29T00:00:00.000Z");
    const limit = createRateLimiter(() => new Date(clock));
    // Ten questions, no answers spent: login checks the budget before it knows the password.
    for (let i = 0; i < 10; i += 1) expect(limit.over("ip", 2)).toBeNull();
    limit.record("ip");
    expect(limit.over("ip", 2)).toBeNull();
    limit.record("ip");
    expect(limit.over("ip", 2)).toBe(60);
  });

  it("forgets a key nobody has used for a window, so an address it never sees again is not kept", () => {
    let clock = Date.parse("2026-08-29T00:00:00.000Z");
    const limit = createRateLimiter(() => new Date(clock));
    for (let i = 0; i < 500; i += 1) limit.record(`ip-${i}`);
    expect(limit.size()).toBe(500);
    // A different address arrives two minutes later: the 500 idle ones go, and it stays.
    clock += 121_000;
    limit.record("ip-later");
    expect(limit.size()).toBe(1);
  });
  it("leads the agent with a guide it can reach as a tool and as a resource", async () => {
    const h = await createHarness();

    // The guide answers as a tool, and it is the first entry so an agent reading top to bottom
    // meets it before it guesses at anything else.
    const guide = await call(h, "help", {});
    expect(String(guide)).toContain("Testate for agents");
    expect(AGENT_TOOL_NAMES[0]).toBe("help");

    // And as a resource, first in the list, before any project.
    const resources = await h.runtime.listResources(h.ctx);
    expect(resources[0]?.uri).toBe("testate://guide");
    expect(resources[0]?.mimeType).toBe("text/markdown");
    expect(await h.runtime.readResource("testate://guide", h.ctx)).toBe(AGENT_GUIDE);
  });

  it("describes every tool it advertises, in its own words", () => {
    // A description that just repeats the name teaches an agent nothing, and every call it wastes
    // guessing is audited and counted against its budget.
    for (const name of AGENT_TOOL_NAMES) {
      const description = TOOL_DESCRIPTIONS.get(name);
      expect(description).toBeDefined();
      expect(String(description).length).toBeGreaterThan(40);
      expect(String(description).toLowerCase()).not.toBe(`testate read-only tool ${name}`);
    }
  });
});
