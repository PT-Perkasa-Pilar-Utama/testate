import { describe, expect, it } from "bun:test";
import { archiveManifestSchema, stateSchema, stateTreeNodeSchema } from "@testate/shared";
import * as v from "valibot";

import { TEST_META } from "../../../test/accounts.ts";
import { PG, createAdaptersHarness, createSettled } from "../../../test/adapters.ts";
import type { AdaptersHarness } from "../../../test/adapters.ts";
import { expectContract } from "../../../test/contract.ts";
import { ARCHIVE_MANIFEST_MOCK, STATE_MOCK, TREE_MOCK } from "./states.mock.ts";
import { createStatesService } from "./states.service.ts";
import type { StatesService } from "./states.service.ts";

const LIST = { limit: 50, sort: "created_at" as const, order: "asc" as const, includeStash: false };

async function createStatesHarness(): Promise<{ harness: AdaptersHarness; states: StatesService }> {
  const harness = await createAdaptersHarness();
  const states = createStatesService({
    repo: harness.states,
    projects: harness.projectsRepo,
    adapters: harness.repo,
    jobs: harness.runtime.jobs,
    audit: harness.audit,
    now: harness.now,
  });
  return { harness, states };
}

async function snapshotSettled(
  h: { harness: AdaptersHarness; states: StatesService },
  name: string,
  tags: string[] = []
): Promise<string> {
  const { state, job } = await h.states.snapshot(h.harness.qa, "shop", { name, tags }, TEST_META);
  const done = await h.harness.runtime.jobs.wait(null, job.id, 5);
  expect(done.error).toBeNull();
  return state.id;
}

function initIdOf(harness: AdaptersHarness, adapterId: string): string {
  const init = harness.states.latestInit(adapterId);
  if (init === null) throw new Error("no init state");
  return init.state_id;
}

describe("states", () => {
  it("mocks match the contract", () => {
    expectContract(stateSchema, STATE_MOCK, (clone) => {
      clone["name"] = "01991f00-0000-7000-8000-000000000031";
    });
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
});
