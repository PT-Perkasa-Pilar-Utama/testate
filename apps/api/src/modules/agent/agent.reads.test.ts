import { describe, expect, it } from "bun:test";
import * as v from "valibot";

import { TEST_META } from "../../../test/accounts.ts";
import { call, createHarness } from "./agent.harness.ts";

const stateResult = v.object({
  name: v.string(),
  adapters: v.array(
    v.object({ tables: v.array(v.object({ name: v.string(), rows: v.number() })) })
  ),
});

/**
 * The two read tools nothing else covers.
 *
 * Both hand an agent something a person reads on a screen, and both answer from a service an
 * agent token may not drive itself: a viewer cannot take a state or start a diff. The harness
 * lends its own services to build the thing the tool then reads.
 */
describe("what an agent may read about a state", () => {
  it("answers with the tables of a state and no blob hash for any of them", async () => {
    const h = await createHarness();
    const state = v.parse(
      stateResult,
      await call(h, "get_state", { project: "shop", state: "init" })
    );
    expect(state.name).toBe("init");
    expect(state.adapters.length).toBeGreaterThan(0);
    const tables = state.adapters.flatMap((adapter) => adapter.tables);
    expect(tables.length).toBeGreaterThan(0);
    // A blob hash addresses the stored snapshot itself. It is how a state is put back, it means
    // nothing to a reader, and the tool strips it from every table on the way out.
    for (const table of tables) expect(Object.keys(table)).not.toContain("blob_hash");
  });

  it("names a state that is not there instead of answering with an empty one", async () => {
    const h = await createHarness();
    await expect(
      call(h, "get_state", { project: "shop", state: "no-such-state" })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("summarises a diff by what changed per table", async () => {
    const h = await createHarness();
    const { diff } = await h.diffs.create(
      h.harness.qa,
      "shop",
      "init",
      "live",
      undefined,
      TEST_META
    );
    const summary = v.parse(
      v.object({
        id: v.string(),
        status: v.string(),
        base: v.object({ name: v.string() }),
        adapters: v.array(v.object({ name: v.string(), compared: v.boolean() })),
      }),
      await call(h, "diff_summary", { project: "shop", diff: diff.id })
    );
    expect(summary.id).toBe(diff.id);
    expect(summary.base.name).toBe("init");
    expect(summary.adapters.length).toBeGreaterThan(0);
  });

  it("refuses a diff belonging to a project the token is not scoped to", async () => {
    const h = await createHarness();
    const { diff } = await h.diffs.create(
      h.harness.qa,
      "shop",
      "init",
      "live",
      undefined,
      TEST_META
    );
    const scoped = { ...h.ctx, scope: [] };
    await expect(
      call(h, "diff_summary", { project: "shop", diff: diff.id }, scoped)
    ).rejects.toBeDefined();
  });
});
