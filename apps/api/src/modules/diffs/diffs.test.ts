import { describe, expect, it } from "bun:test";
import { diffRowSchema, diffSchema } from "@testate/shared";
import type { Diff, Job } from "@testate/shared";
import * as v from "valibot";

import { TEST_META } from "../../../test/accounts.ts";
import { PG, createAdaptersHarness, createSettled } from "../../../test/adapters.ts";
import type { AdaptersHarness } from "../../../test/adapters.ts";
import { expectContract } from "../../../test/contract.ts";
import { createPoliciesRepository } from "../data/data.policies.ts";
import { createTestSettings } from "../../../test/settings.ts";
import { createStatesService } from "../states/states.service.ts";
import { DIFF_MOCK, DIFF_ROWS_MOCK } from "./diffs.mock.ts";
import { createDiffsService } from "./diffs.service.ts";
import type { DiffsService } from "./diffs.service.ts";

type Harness = {
  harness: AdaptersHarness;
  diffs: DiffsService;
  adapterId: string;
  policies: ReturnType<typeof createPoliciesRepository>;
};

async function createHarness(): Promise<Harness> {
  const harness = await createAdaptersHarness();
  const adapter = await createSettled(harness, PG);
  const policies = createPoliciesRepository(harness.db);
  const diffs = createDiffsService({
    repo: harness.diffs,
    states: harness.states,
    adapters: harness.repo,
    policies,
    projects: harness.projectsRepo,
    blobs: harness.blobs,
    jobs: harness.runtime.jobs,
    settings: createTestSettings(harness.db, harness.audit, harness.now),
    audit: harness.audit,
    now: harness.now,
  });
  return { harness, diffs, adapterId: adapter.id, policies };
}

async function settled(h: Harness, started: { diff: Diff; job: Job }): Promise<Diff> {
  const job = await h.harness.runtime.jobs.wait(null, started.job.id, 5);
  expect(job.error).toBeNull();
  return h.diffs.get("shop", started.diff.id);
}

async function manualState(h: Harness, name: string): Promise<string> {
  const states = createStatesService({
    repo: h.harness.states,
    projects: h.harness.projectsRepo,
    adapters: h.harness.repo,
    jobs: h.harness.runtime.jobs,
    blobs: h.harness.blobs,
    uploads: h.harness.imports,
    audit: h.harness.audit,
    now: h.harness.now,
  });
  const { state, job } = await states.snapshot(h.harness.qa, "shop", { name }, TEST_META);
  await h.harness.runtime.jobs.wait(null, job.id, 5);
  return state.id;
}

function tablesOf(diff: Diff): Diff["adapters"][number]["tables"] {
  const first = diff.adapters[0];
  if (first === undefined) throw new Error("diff has no adapter");
  return first.tables;
}

function hiddenStateOf(diff: Diff): string {
  if (!("live" in diff.target)) throw new Error("diff has no live target");
  if (diff.target.snapshot_state_id === null) throw new Error("live diff has no snapshot yet");
  return diff.target.snapshot_state_id;
}

describe("diffs", () => {
  it("mocks match the contract", () => {
    // A live diff has no snapshot state until its job starts (story 89).
    expectContract(
      diffSchema,
      { ...DIFF_MOCK, status: "running", target: { live: true, snapshot_state_id: null } },
      (clone) => {
        clone["target"] = { live: true, snapshot_state_id: 7 };
      }
    );
    expectContract(diffSchema, DIFF_MOCK, (clone) => {
      clone["adapters"] = [{ tables: "many" }];
    });
    expect(v.safeParse(v.array(diffRowSchema), DIFF_ROWS_MOCK).success).toBe(true);
  });

  it("diffs two states table by table: unchanged blobs cost nothing, changes are counted and stored", async () => {
    const h = await createHarness();
    const shop = h.harness.databases.get("shop");
    shop?.set("public.customers", [
      { id: 1, email: "a2@x.io" },
      { id: 3, email: "c@x.io" },
    ]);
    const after = await manualState(h, "after");
    const diff = await settled(
      h,
      await h.diffs.create(h.harness.qa, "shop", "init", { state_id: after }, undefined, TEST_META)
    );
    expect(diff.status).toBe("ready");
    const tables = tablesOf(diff);
    expect(
      tables.map(
        (table) =>
          `${table.name}:${table.added}/${table.removed}/${table.changed}:${table.unchanged}`
      )
    ).toEqual(["customers:1/1/1:false", "orders:0/0/0:true"]);
    const rows = await h.diffs.rows(h.harness.qa, "shop", diff.id, {
      adapter_id: h.adapterId,
      table: "public.customers",
      limit: 10,
    });
    expect(rows.data.map((row) => `${row.op}:${String(row.k)}`)).toEqual([
      "changed:1",
      "removed:2",
      "added:3",
    ]);
    expect(rows.data[0]?.changed_columns).toEqual(["email"]);
    const onlyAdded = await h.diffs.rows(h.harness.qa, "shop", diff.id, {
      adapter_id: h.adapterId,
      table: "public.customers",
      op: "added",
      limit: 10,
    });
    expect(onlyAdded.data.length).toBe(1);
    const paged = await h.diffs.rows(h.harness.qa, "shop", diff.id, {
      adapter_id: h.adapterId,
      table: "public.customers",
      limit: 2,
    });
    expect(paged.next_cursor).toBe("2");
    expect((await h.diffs.list("shop", 10)).map((item) => item.id)).toEqual([diff.id]);
  });

  it("a table keyed one way and then the other says so instead of inventing rows", async () => {
    const h = await createHarness();
    // What adding or dropping a primary key between two snapshots does to the same table.
    h.harness.rowHashTables.add("public.customers");
    const rekeyed = await manualState(h, "rekeyed");
    const diff = await settled(
      h,
      await h.diffs.create(
        h.harness.qa,
        "shop",
        "init",
        { state_id: rekeyed },
        undefined,
        TEST_META
      )
    );
    expect(diff.status).toBe("ready");
    expect(
      tablesOf(diff).map(
        (table) =>
          `${table.name}:${table.added}/${table.removed}/${table.changed}:${String(table.schema_changed)}`
      )
    ).toEqual(["customers:0/0/0:key changed: primary-key to row-hash", "orders:0/0/0:null"]);
  });

  it("a diff of HEAD against live settles whether the databases moved off it", async () => {
    const h = await createHarness();
    await settled(
      h,
      await h.diffs.create(h.harness.qa, "shop", "init", "live", undefined, TEST_META)
    );
    expect(h.harness.projectsRepo.bySlug("shop")?.head.dirty).toBe(false);
    h.harness.databases.get("shop")?.set("public.orders", []);
    await settled(
      h,
      await h.diffs.create(h.harness.qa, "shop", "init", "live", undefined, TEST_META)
    );
    expect(h.harness.projectsRepo.bySlug("shop")?.head.dirty).toBe(true);
  });

  it("a live target takes a hidden diff state that never lists and dies with the diff", async () => {
    const h = await createHarness();
    h.harness.databases.get("shop")?.set("public.orders", []);
    const diff = await settled(
      h,
      await h.diffs.create(h.harness.qa, "shop", "init", "live", undefined, TEST_META)
    );
    expect("live" in diff.target).toBe(true);
    const hidden = hiddenStateOf(diff);
    expect(h.harness.db.query("SELECT kind FROM states WHERE id = ?").get(hidden)).toEqual({
      kind: "diff",
    });
    expect(diff.adapters[0]?.tables.find((table) => table.name === "orders")?.removed).toBe(1);
    expect(h.harness.projectsRepo.bySlug("shop")?.head.state_name).toBe("init");
    const before = h.harness.db.query("SELECT COUNT(*) AS n FROM blobs").get();
    await h.diffs.remove(h.harness.qa, "shop", diff.id, TEST_META);
    expect(h.harness.db.query("SELECT COUNT(*) AS n FROM states WHERE id = ?").get(hidden)).toEqual(
      { n: 0 }
    );
    expect(h.harness.db.query("SELECT COUNT(*) AS n FROM blobs").get()).not.toEqual(before);
    await expect(h.diffs.get("shop", diff.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("masks policed columns for viewers on both sides and exports rows", async () => {
    const h = await createHarness();
    h.policies.upsert(
      h.adapterId,
      {
        table: "public.customers",
        column: "email",
        required_function: null,
        mask: "redact",
        display: false,
      },
      h.harness.qa.id,
      "2026-08-29T00:00:00.000Z"
    );
    h.harness.databases.get("shop")?.set("public.customers", [
      { id: 1, email: "changed@x.io" },
      { id: 2, email: "b@x.io" },
    ]);
    const after = await manualState(h, "after");
    const diff = await settled(
      h,
      await h.diffs.create(h.harness.qa, "shop", "init", { state_id: after }, undefined, TEST_META)
    );
    const viewer = { ...h.harness.qa, role: "viewer" as const };
    const rows = await h.diffs.rows(viewer, "shop", diff.id, {
      adapter_id: h.adapterId,
      table: "public.customers",
      limit: 10,
    });
    expect(rows.data[0]).toMatchObject({ before: { email: "***" }, after: { email: "***" } });
    expect(rows.masked_columns).toEqual(["email"]);
    const exported = [];
    for await (const row of h.diffs.exportRows(h.harness.qa, "shop", diff.id, undefined, undefined))
      exported.push(row);
    expect(exported.map((row) => `${row.table}:${row.op}`)).toEqual(["public.customers:changed"]);
    expect(exported[0]?.after?.["email"]).toBe("changed@x.io");
  });

  it("refuses states that share no adapter and expires old diffs with their blobs", async () => {
    const h = await createHarness();
    await expect(
      h.diffs.create(
        h.harness.qa,
        "shop",
        "init",
        { state_id: "init" },
        ["01991f00-0000-7000-8000-000000000999"],
        TEST_META
      )
    ).rejects.toThrow("share no adapter");
    const diff = await settled(
      h,
      await h.diffs.create(h.harness.qa, "shop", "init", { state_id: "init" }, undefined, TEST_META)
    );
    expect(diff.adapters[0]?.tables.every((table) => table.unchanged)).toBe(true);
    h.harness.advance(400 * 24 * 60 * 60 * 1000);
    expect(await h.diffs.expire()).toBe(1);
    await expect(h.diffs.get("shop", diff.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
