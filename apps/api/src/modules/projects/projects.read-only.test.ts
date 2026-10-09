import { describe, expect, it } from "bun:test";
import type { MetadataDb } from "../../lib/db/index.ts";

import { TEST_META } from "../../../test/accounts.ts";
import { NORMALIZER, createImportsHarness } from "../../../test/imports-harness.ts";
import * as v from "valibot";

import { PG } from "../../../test/adapters.ts";
import { call, createHarness } from "../agent/agent.harness.ts";
import { ensureInspectProject } from "./projects.inspect.ts";

// #56, Q4 (docs/decisions/2026-10-09-inspect-project.md): what the Inspect project refuses. Each
// spec builds an ordinary project and turns it into Inspect, which is what the kind check sees.
const REFUSED = { code: "PROJECT_READ_ONLY" };
const SOME_ID = "01991f00-0000-7000-8000-000000000099";

/** The `shop` project as Inspect holds it: kind `inspect`, every adapter read-only (Q5). */
function asInspect(db: MetadataDb): void {
  db.query("UPDATE projects SET kind = 'inspect' WHERE slug = 'shop'").run();
  db.query("UPDATE adapters SET mode = 'read_only'").run();
}

describe("the Inspect project refuses what writes", () => {
  it("snapshots, checkouts and writes over MCP, whatever the token's role", async () => {
    const h = await createHarness();
    asInspect(h.harness.db);
    const take = { project: "shop", name: "in-inspect" };
    await expect(call(h, "take_snapshot", take, h.tester)).rejects.toMatchObject(REFUSED);
    await expect(
      call(h, "checkout_state", { project: "shop", state: "init" }, h.tester)
    ).rejects.toMatchObject(REFUSED);
    const write = { project: "shop", adapter: "orders-db", sql: "DELETE FROM customers" };
    await expect(call(h, "run_write_query", write, h.tester)).rejects.toMatchObject({
      code: "ADAPTER_READ_ONLY",
    });
  });

  it("snapshots, state archives and diffs through the services the routes use", async () => {
    const h = await createHarness();
    asInspect(h.harness.db);
    const qa = h.harness.qa;
    await expect(h.states.snapshot(qa, "shop", { name: "x" }, TEST_META)).rejects.toMatchObject(
      REFUSED
    );
    await expect(
      h.states.importArchive(
        qa,
        "shop",
        { upload_id: SOME_ID, name: "x", adapter_mapping: [] },
        TEST_META
      )
    ).rejects.toMatchObject(REFUSED);
    await expect(
      h.diffs.create(qa, "shop", SOME_ID, "live", undefined, TEST_META)
    ).rejects.toMatchObject(REFUSED);
  });

  it("still lets anyone look", async () => {
    const h = await createHarness();
    asInspect(h.harness.db);
    const read = { project: "shop", adapter: "orders-db", sql: "SELECT * FROM public.customers" };
    await expect(call(h, "run_readonly_query", read)).resolves.toBeDefined();
    await expect(
      call(h, "list_tables", { project: "shop", adapter: "orders-db" })
    ).resolves.toBeDefined();
  });

  it("uploads, imports and normalizers", async () => {
    const h = await createImportsHarness();
    asInspect(h.harness.db);
    const qa = h.harness.qa;
    const file = new File(["Email\na@b.c\n"], "people.csv");
    await expect(h.imports.upload("shop", file, "import")).rejects.toMatchObject(REFUSED);
    await expect(h.imports.createNormalizer(qa, h.adapterId, NORMALIZER)).rejects.toMatchObject(
      REFUSED
    );
    const run = {
      adapter_id: h.adapterId,
      normalizer_id: SOME_ID,
      source: { upload_id: SOME_ID },
      dry_run: true,
      foreign_key_checks: true,
    };
    await expect(h.imports.run(qa, "shop", run, TEST_META)).rejects.toMatchObject(REFUSED);
  });

  it("a viewer agent token scoped to Inspect lists, browses and queries it, and writes nothing", async () => {
    const h = await createHarness();
    const { harness } = h;
    ensureInspectProject(harness.projectsRepo, () => harness.admin.id, harness.now);
    const inspect = v.parse(v.object({ id: v.string() }), harness.projectsRepo.byKind("inspect"));
    const { mode: _mode, ...draft } = PG;
    await harness.adapters.create(
      harness.qa,
      "inspect",
      { ...draft, name: "orders-ro" },
      TEST_META
    );
    const ctx = { ...h.ctx, scope: [inspect.id] };
    const projects = v.parse(
      v.array(v.object({ slug: v.string() })),
      await call(h, "list_projects", {}, ctx)
    );
    expect(projects.map((project) => project.slug)).toStrictEqual(["inspect"]);
    const adapters = v.parse(
      v.array(v.object({ name: v.string() })),
      await call(h, "list_adapters", { project: "inspect" }, ctx)
    );
    expect(adapters.map((adapter) => adapter.name)).toStrictEqual(["orders-ro"]);
    const read = {
      project: "inspect",
      adapter: "orders-ro",
      sql: "SELECT * FROM public.customers",
    };
    await expect(call(h, "run_readonly_query", read, ctx)).resolves.toBeDefined();
    await expect(call(h, "list_adapters", { project: "shop" }, ctx)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      call(h, "take_snapshot", { project: "inspect", name: "x" }, ctx)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
