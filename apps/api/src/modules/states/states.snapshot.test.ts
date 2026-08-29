import { describe, expect, it } from "bun:test";
import * as v from "valibot";

import { decodeChunks } from "../../lib/snapshot/codec.ts";
import { PG, createAdaptersHarness, createSettled } from "../../../test/adapters.ts";
import type { AdaptersHarness } from "../../../test/adapters.ts";
import type { InitManifest } from "./states.repository.ts";
import { TEST_META } from "../../../test/accounts.ts";

const stateRow = v.object({
  name: v.string(),
  kind: v.string(),
  status: v.string(),
  protected: v.number(),
  size_bytes: v.number(),
  job_id: v.string(),
});
const headRow = v.object({ head_state_id: v.nullable(v.string()), head_status: v.string() });
const refRow = v.object({ ref_count: v.number(), size_bytes: v.number() });

function requireInit(harness: AdaptersHarness, adapterId: string): InitManifest {
  const init = harness.states.latestInit(adapterId);
  if (init === null) throw new Error("no init state");
  return init;
}

function firstBlob(init: InitManifest): string {
  const first = init.manifest.tables[0];
  if (first === undefined) throw new Error("empty manifest");
  return first.blob_hash;
}

/** Creates a database adapter and returns its queued init job without waiting for it. */
async function createUnsettled(
  harness: AdaptersHarness,
  draft: typeof PG
): Promise<{ adapterId: string; jobId: string }> {
  const created = await harness.adapters.create(harness.qa, "shop", draft, TEST_META);
  if (created.init_job === null) throw new Error("database adapters always get an init job");
  return { adapterId: created.adapter.id, jobId: created.init_job.id };
}

describe("init snapshot job", () => {
  it("commits the manifest as a protected init state and moves HEAD to it", async () => {
    const harness = await createAdaptersHarness();
    const adapter = await createSettled(harness, PG);
    const state = v.parse(
      stateRow,
      harness.db.query("SELECT * FROM states WHERE project_id = ?").get(adapter.project_id)
    );
    expect(state).toMatchObject({ name: "init", kind: "init", status: "ready", protected: 1 });
    expect(state.size_bytes).toBeGreaterThan(0);
    const init = requireInit(harness, adapter.id);
    expect(init.manifest.tables.map((table) => `${table.name}:${table.rows}`)).toEqual([
      "customers:2",
      "orders:1",
    ]);
    expect(init.manifest.engine_version).toBe("16.3");
    const head = v.parse(
      headRow,
      harness.db
        .query("SELECT head_state_id, head_status FROM projects WHERE id = ?")
        .get(adapter.project_id)
    );
    expect(head).toEqual({ head_state_id: init.state_id, head_status: "at_state" });
  });

  it("writes one deterministic blob per table, counts one reference, and releases the pins", async () => {
    const harness = await createAdaptersHarness();
    const adapter = await createSettled(harness, PG);
    const init = requireInit(harness, adapter.id);
    const blob = v.parse(
      refRow,
      harness.db
        .query("SELECT ref_count, size_bytes FROM blobs WHERE hash = ?")
        .get(firstBlob(init))
    );
    expect(blob.ref_count).toBe(1);
    expect(harness.db.query("SELECT COUNT(*) AS n FROM blob_pins").get()).toEqual({ n: 0 });
    const rows: string[] = [];
    for await (const row of decodeChunks(harness.blobs.get(firstBlob(init)))) {
      rows.push(row.json);
    }
    expect(rows).toEqual(['{"id":1,"email":"a@x.io"}', '{"id":2,"email":"b@x.io"}']);
  });

  it("names the second adapter's init state after the adapter", async () => {
    const harness = await createAdaptersHarness();
    await createSettled(harness, PG);
    const second = await createSettled(harness, { ...PG, name: "billing-db" });
    expect(requireInit(harness, second.id).state_name).toBe("init-billing-db");
  });

  it("fails the state and the job when the database is unreachable, leaving no pins", async () => {
    const harness = await createAdaptersHarness();
    const draft = { ...PG, config: { ...PG.config, database: "shop" } };
    const created = await createUnsettled(harness, draft);
    harness.databases.delete("shop");
    const job = await harness.runtime.jobs.wait(null, created.jobId, 5);
    expect(job.status).toBe("failed");
    const state = v.parse(
      stateRow,
      harness.db.query("SELECT * FROM states WHERE job_id = ?").get(job.id)
    );
    expect(state.status).toBe("failed");
    expect(harness.states.latestInit(created.adapterId)).toBeNull();
    expect(harness.db.query("SELECT COUNT(*) AS n FROM blob_pins").get()).toEqual({ n: 0 });
  });
});
