import { describe, expect, it } from "bun:test";
import { AGENT_TOOL_INPUTS } from "@testate/shared";
import * as v from "valibot";

import { S3, createSettled } from "../../../test/adapters.ts";
import type { MemoryTree } from "../../lib/files/index.ts";
import { createRateLimiter } from "../../lib/http/ratelimit.ts";
import { TOOL_DESCRIPTIONS, agentGuide } from "./agent.guide.ts";
import { call, createHarness, rowResult, rowsResult, uriAt } from "./agent.harness.ts";
import type { AgentContext } from "./agent.service.ts";

const AGENT_TOOL_NAMES = Object.keys(AGENT_TOOL_INPUTS);

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
    expect(await h.runtime.readResource("testate://guide", h.ctx)).toBe(agentGuide("viewer"));
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
