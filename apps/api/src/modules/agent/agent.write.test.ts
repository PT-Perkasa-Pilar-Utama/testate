import { describe, expect, it } from "bun:test";
import type { JsonObject } from "@testate/shared";
import * as v from "valibot";

import { call, createHarness } from "./agent.harness.ts";
import { agentGuide } from "./agent.guide.ts";

describe("agent tools a tester has", () => {
  it("refuses every tester tool to a viewer agent token, and names the role", async () => {
    const h = await createHarness();
    const calls: [string, JsonObject][] = [
      ["run_write_query", { project: "shop", adapter: "orders-db", sql: "DELETE FROM x" }],
      ["end_write_session", { project: "shop", adapter: "orders-db" }],
      ["take_snapshot", { project: "shop", name: "from-a-viewer" }],
      ["checkout_state", { project: "shop", state: "init" }],
    ];
    for (const [tool, args] of calls) {
      await expect(call(h, tool, args)).rejects.toMatchObject({
        code: "FORBIDDEN",
        details: { reason: "role" },
      });
    }
    const states = v.parse(
      v.array(v.object({ name: v.string() })),
      await call(h, "list_states", { project: "shop" })
    );
    expect(states.map((state) => state.name)).toEqual(["init"]);
  });

  it("a tester agent token writes, keeps a state, and puts the earlier one back", async () => {
    const h = await createHarness();
    const before = v.parse(
      v.object({ rows: v.array(v.any()) }),
      await call(h, "run_readonly_query", {
        project: "shop",
        adapter: "orders-db",
        sql: "SELECT * FROM public.customers",
      })
    );

    const write = v.parse(
      v.object({ write_session_id: v.string() }),
      await call(
        h,
        "run_write_query",
        { project: "shop", adapter: "orders-db", sql: "DELETE FROM public.customers" },
        h.tester
      )
    );
    const again = v.parse(
      v.object({ write_session_id: v.string() }),
      await call(
        h,
        "run_write_query",
        { project: "shop", adapter: "orders-db", sql: "DELETE FROM public.customers" },
        h.tester
      )
    );
    // One session across both writes, so the run leaves one stash and not one per statement.
    expect(again.write_session_id).toBe(write.write_session_id);

    const snapshot = v.parse(
      v.object({ state: v.object({ name: v.string() }), job: v.object({ status: v.string() }) }),
      await call(h, "take_snapshot", { project: "shop", name: "after-the-delete" }, h.tester)
    );
    expect(snapshot.job.status).toBe("succeeded");

    await call(h, "end_write_session", { project: "shop", adapter: "orders-db" }, h.tester);
    const restore = v.parse(
      v.object({ job: v.object({ id: v.string(), status: v.string() }) }),
      await call(h, "checkout_state", { project: "shop", state: "init" }, h.tester)
    );
    expect(restore.job.status).toBe("succeeded");
    const job = v.parse(
      v.object({ status: v.string() }),
      await call(h, "get_job", { job: restore.job.id }, h.tester)
    );
    expect(job.status).toBe("succeeded");

    const after = v.parse(
      v.object({ rows: v.array(v.any()) }),
      await call(h, "run_readonly_query", {
        project: "shop",
        adapter: "orders-db",
        sql: "SELECT * FROM public.customers",
      })
    );
    expect(after.rows.length).toBe(before.rows.length);
  });

  it("tells a tester what it may do and a viewer that it may not", async () => {
    expect(agentGuide("viewer")).toContain("read-only");
    expect(agentGuide("viewer")).toContain("No writes.");
    expect(agentGuide("qa")).toContain("tester role");
    expect(agentGuide("qa")).not.toContain("No writes.");
  });
});
