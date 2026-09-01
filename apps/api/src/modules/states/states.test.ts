import { describe, expect, it } from "bun:test";
import { archiveManifestSchema, stateSchema, stateTreeNodeSchema } from "@testate/shared";
import * as v from "valibot";

import { TEST_META } from "../../../test/accounts.ts";
import { PG, PROJECT_ID, createSettled } from "../../../test/adapters.ts";
import { expectContract } from "../../../test/contract.ts";
import {
  LIST,
  createStatesHarness,
  initIdOf,
  snapshotSettled,
} from "../../../test/states-harness.ts";
import { ARCHIVE_MANIFEST_MOCK, STASH_MOCK, STATE_MOCK, TREE_MOCK } from "./states.mock.ts";

describe("states", () => {
  it("mocks match the contract", () => {
    expectContract(stateSchema, STATE_MOCK, (clone) => {
      clone["name"] = "01991f00-0000-7000-8000-000000000031";
    });
    // A write-session stash is taken inline and carries no job (story 76 via the grid).
    expectContract(
      stateSchema,
      { ...STASH_MOCK, stash_reason: "write-session", job_id: null },
      (clone) => {
        clone["job_id"] = 7;
      }
    );
    expectContract(archiveManifestSchema, ARCHIVE_MANIFEST_MOCK, (clone) => {
      clone["adapters"] = [{ engine: "postgres" }];
    });
    expect(v.safeParse(v.array(stateTreeNodeSchema), TREE_MOCK).success).toBe(true);
  });

  it("takes a manual state over every database adapter, parented on HEAD, and moves HEAD", async () => {
    const h = await createStatesHarness();
    const adapter = await createSettled(h.harness, PG);
    const initId = initIdOf(h.harness, adapter.id);
    const id = await snapshotSettled(h, "seeded-baseline", ["baseline"]);
    const detail = await h.states.get("shop", "SEEDED-BASELINE");
    expect(detail).toMatchObject({
      id,
      kind: "manual",
      status: "ready",
      protected: false,
      tags: ["baseline"],
      parent_state_id: initId,
      actor: { kind: "user", label: "dina.qa", role: "qa" },
    });
    expect(detail.adapters[0]?.tables.map((table) => table.name)).toEqual(["customers", "orders"]);
    expect(h.harness.projectsRepo.bySlug("shop")?.head).toMatchObject({
      state_id: id,
      status: "at_state",
    });
    const tree = await h.states.tree("shop", false);
    expect(
      tree.map((node) => `${node.name}>${node.children.map((child) => child.name).join(",")}`)
    ).toEqual(["init>seeded-baseline"]);
    expect(tree[0]?.children[0]?.is_head).toBe(true);
  });

  it("lists by kind, tag, and name and hides stashes unless asked", async () => {
    const h = await createStatesHarness();
    await createSettled(h.harness, PG);
    await snapshotSettled(h, "tagged", ["x"]);
    h.harness.db.query("UPDATE states SET kind = 'stash' WHERE name = 'tagged'").run();
    expect((await h.states.list("shop", LIST)).map((state) => state.name)).toEqual(["init"]);
    expect((await h.states.list("shop", { ...LIST, includeStash: true })).length).toBe(2);
    expect((await h.states.list("shop", { ...LIST, includeStash: true, tag: "x" })).length).toBe(1);
    expect((await h.states.list("shop", { ...LIST, kind: "init" })).length).toBe(1);
    expect((await h.states.list("shop", { ...LIST, name: "init" })).length).toBe(1);
  });

  it("replays the first job and state when a request repeats its Idempotency-Key", async () => {
    const h = await createStatesHarness();
    await createSettled(h.harness, PG);
    const meta = { ...TEST_META, idempotency_key: "nightly-1" };
    const first = await h.states.snapshot(h.harness.qa, "shop", { name: "nightly" }, meta);
    // A retry would otherwise be refused as a duplicate name, or take a second snapshot.
    const again = await h.states.snapshot(h.harness.qa, "shop", { name: "nightly" }, meta);
    expect(again.job.id).toBe(first.job.id);
    expect(again.state.id).toBe(first.state.id);
    expect((await h.states.list("shop", { ...LIST, name: "nightly" })).length).toBe(1);
    await expect(
      h.states.snapshot(h.harness.qa, "shop", { name: "other" }, meta)
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await h.harness.runtime.dispatcher.drain(100);
  });

  it("refuses a duplicate name, an unknown adapter, and a project without database adapters", async () => {
    const h = await createStatesHarness();
    await expect(h.states.snapshot(h.harness.qa, "shop", { name: "a" }, TEST_META)).rejects.toThrow(
      "no database adapter"
    );
    await createSettled(h.harness, PG);
    await expect(
      h.states.snapshot(h.harness.qa, "shop", { name: "Init" }, TEST_META)
    ).rejects.toThrow("state name is taken");
    await expect(
      h.states.snapshot(h.harness.qa, "shop", { name: "b", adapter_ids: ["nope"] }, TEST_META)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("protects, converts a protected stash to manual, and keeps init protected", async () => {
    const h = await createStatesHarness();
    await createSettled(h.harness, PG);
    const id = await snapshotSettled(h, "s1");
    h.harness.db.query("UPDATE states SET kind = 'stash' WHERE id = ?").run(id);
    const updated = await h.states.update(h.harness.qa, "shop", id, { protected: true }, TEST_META);
    expect(updated).toMatchObject({ kind: "manual", protected: true });
    await expect(
      h.states.update(h.harness.qa, "shop", "init", { protected: false }, TEST_META)
    ).rejects.toThrow("init states stay protected");
    await expect(h.states.remove(h.harness.qa, "shop", id, TEST_META)).rejects.toThrow(
      "state is protected"
    );
    await expect(h.states.remove(h.harness.qa, "shop", "init", TEST_META)).rejects.toThrow(
      "init states cannot be deleted"
    );
  });

  it("deletes a state, keeps shared blobs, frees unique ones, and clears HEAD", async () => {
    const h = await createStatesHarness();
    const adapter = await createSettled(h.harness, PG);
    const shared = await snapshotSettled(h, "same-data");
    h.harness.databases
      .get("shop")
      ?.set("public.orders", [{ id: 1, customer_id: 2, total: "1.00" }]);
    const changed = await snapshotSettled(h, "changed-orders");
    const before = h.harness.db.query("SELECT COUNT(*) AS n FROM blobs").get();
    expect(before).toEqual({ n: 3 });
    const job = await h.states.remove(h.harness.qa, "shop", changed, TEST_META);
    const done = await h.harness.runtime.jobs.wait(null, job.id, 5);
    expect(done.status).toBe("succeeded");
    expect(done.result).toEqual({ blobs_deleted: 1, head_cleared: true });
    expect(h.harness.db.query("SELECT COUNT(*) AS n FROM blobs").get()).toEqual({ n: 2 });
    expect(h.harness.projectsRepo.bySlug("shop")?.head.status).toBe("none");
    await expect(h.states.get("shop", changed)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await h.states.get("shop", shared)).status).toBe("ready");
    expect(h.harness.states.latestInit(adapter.id)).not.toBeNull();
  });

  it("a state carries what it produced: restores and the diffs on either side of it", async () => {
    const h = await createStatesHarness();
    const adapter = await createSettled(h.harness, PG);
    const initId = initIdOf(h.harness, adapter.id);
    const { state } = await h.states.snapshot(
      h.harness.qa,
      "shop",
      { name: "as-base", adapter_ids: [adapter.id] },
      TEST_META
    );
    const at = "2026-09-02T00:00:00.000Z";
    h.harness.db
      .query(
        `INSERT INTO checkouts (id, project_id, state_id, job_id, status, created_at)
         VALUES (?, ?, ?, ?, 'succeeded', ?)`
      )
      .run("01a05e00-0000-7000-8000-00000000c001", PROJECT_ID, state.id, "j1", at);
    // One diff names a state as its base and the other names a different state as its target.
    // Counting either column alone gets one of the two wrong, which is why the query unions both.
    const diff = h.harness.db.query(
      `INSERT INTO diffs (id, project_id, base_state_id, target_state_id, job_id, expires_at, created_at)
       VALUES (?, ?, ?, ?, 'j3', ?, ?)`
    );
    diff.run("01a05e00-0000-7000-8000-00000000d001", PROJECT_ID, state.id, null, at, at);
    diff.run("01a05e00-0000-7000-8000-00000000d002", PROJECT_ID, "elsewhere", initId, at, at);

    const listed = await h.states.list("shop", {
      limit: 20,
      sort: "created_at",
      order: "desc",
      includeStash: false,
    });
    const counts = new Map(listed.map((row) => [row.name, row]));
    expect(counts.get("as-base")).toMatchObject({ checkout_count: 1, diff_count: 1 });
    expect(counts.get("init")).toMatchObject({ checkout_count: 0, diff_count: 1 });
  });
});
