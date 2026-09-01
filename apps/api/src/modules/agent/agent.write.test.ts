import { describe, expect, it } from "bun:test";
import type { JsonObject } from "@testate/shared";
import * as v from "valibot";

import { S3, createSettled } from "../../../test/adapters.ts";
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
      ["upload_file", { project: "shop", adapter: "exports", path: "a.txt", content: "x" }],
      ["delete_file", { project: "shop", adapter: "exports", path: "a.txt" }],
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

    const ended = v.parse(
      v.object({ ended: v.nullable(v.string()) }),
      await call(h, "end_write_session", { project: "shop", adapter: "orders-db" }, h.tester)
    );
    expect(ended.ended).toBe(write.write_session_id);
    // Ending again opens nothing: an agent that closes twice leaves one session, not two.
    const twice = v.parse(
      v.object({ ended: v.nullable(v.string()) }),
      await call(h, "end_write_session", { project: "shop", adapter: "orders-db" }, h.tester)
    );
    expect(twice.ended).toBeNull();
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

  it("a tester agent puts a file in a sandbox store and takes it out again", async () => {
    const h = await createHarness();
    const s3 = await createSettled(h.harness, S3);
    h.harness.trees.set("exports", new Map());
    const put = v.parse(
      v.object({ name: v.string(), size_bytes: v.nullable(v.number()) }),
      await call(
        h,
        "upload_file",
        { project: "shop", adapter: s3.name, path: "out/report.csv", content: "id,name\n1,x\n" },
        h.tester
      )
    );
    expect(put).toMatchObject({ name: "report.csv", size_bytes: 12 });
    const listed = v.parse(
      v.object({ entries: v.array(v.object({ path: v.string() })) }),
      await call(h, "list_files", { project: "shop", adapter: s3.name, path: "out" })
    );
    expect(listed.entries.map((entry) => entry.path)).toEqual(["out/report.csv"]);
    await call(
      h,
      "delete_file",
      { project: "shop", adapter: s3.name, path: "out/report.csv" },
      h.tester
    );
    const empty = v.parse(
      v.object({ entries: v.array(v.unknown()) }),
      await call(h, "list_files", { project: "shop", adapter: s3.name, path: "" })
    );
    expect(empty.entries).toEqual([]);
  });

  it("refuses a file an agent sends that is over its byte budget", async () => {
    const h = await createHarness();
    const s3 = await createSettled(h.harness, S3);
    h.harness.trees.set("exports", new Map());
    await expect(
      call(
        h,
        "upload_file",
        {
          project: "shop",
          adapter: s3.name,
          path: "big.txt",
          content: "x".repeat(1024 * 1024 + 1),
        },
        h.tester
      )
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });

  it("tells a tester what it may do and a viewer that it may not", async () => {
    expect(agentGuide("viewer")).toContain("read-only");
    expect(agentGuide("viewer")).toContain("No writes.");
    expect(agentGuide("qa")).toContain("tester role");
    expect(agentGuide("qa")).not.toContain("No writes.");
  });
});
