import { describe, expect, it } from "bun:test";
import type { Actor, AdapterDraft } from "@testate/shared";
import * as v from "valibot";

import { TEST_META } from "../../../test/accounts.ts";
import {
  PG,
  PROJECT_ID,
  S3,
  createAdaptersHarness,
  createSettled,
} from "../../../test/adapters.ts";
import type { AdaptersHarness } from "../../../test/adapters.ts";
import { AppError } from "../../lib/http/index.ts";
import { liveAdapter } from "../checkouts/checkouts.preflight.ts";
import { ensureInspectProject } from "../projects/projects.inspect.ts";

// #77 (M1–M7 of docs/decisions/2026-10-10-move-adapter.md, ADR 0005): an adapter moves with its id;
// a database leaves its old project's states and joins the new one by the create path's init.
const BILLING = "01991f00-0000-7000-8000-0000000000b1";
// The Inspect form sends no mode at all.
const { mode: _mode, ...S3_DRAFT } = S3;
const INGEST: AdapterDraft = {
  kind: "logs",
  engine: "ingest",
  name: "app-logs",
  config: {},
  secrets: {},
};

async function setup(): Promise<AdaptersHarness> {
  const h = await createAdaptersHarness();
  h.projectsRepo.insert({
    id: BILLING,
    slug: "billing",
    name: "Billing",
    description: null,
    quota_bytes: null,
    created_by: h.admin.id,
    created_at: h.now().toISOString(),
  });
  return h;
}

const move = (
  h: AdaptersHarness,
  adapterId: string,
  target: string,
  actor: Actor = h.qa,
  from = "shop"
) => h.adapters.move({ actor, slug: from, adapterId, target, scope: null, meta: TEST_META });

/** The error code a refused call answers with, or "moved". */
async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "moved";
  } catch (cause: unknown) {
    return cause instanceof AppError ? cause.code : String(cause);
  }
}

const removedIn = (h: AdaptersHarness, adapterId: string, projectId: string): number[] =>
  h.db
    .query(
      `SELECT sa.removed FROM state_adapters sa JOIN states s ON s.id = sa.state_id
       WHERE sa.adapter_id = ? AND s.project_id = ?`
    )
    .all(adapterId, projectId)
    .map((row) => v.parse(v.object({ removed: v.number() }), row).removed);

describe("moving an adapter", () => {
  it("moves a database with its id: shop's states let it go, billing takes an init", async () => {
    const h = await setup();
    const db = await createSettled(h, PG);
    const moved = await move(h, db.id, "billing");
    const initJob = v.parse(v.string(), moved.init_job?.id);
    await h.runtime.jobs.wait(null, initJob, 5);
    const audit = (await h.audit.list({ limit: 5, action: "adapter.moved" })).rows;
    expect([moved.adapter.id, moved.adapter.project_id, moved.adapter.mode]).toEqual([
      db.id,
      BILLING,
      "sandbox",
    ]);
    expect([removedIn(h, db.id, PROJECT_ID), removedIn(h, db.id, BILLING)]).toEqual([[1], [0]]);
    expect(audit.map((row) => row.details)).toEqual([
      { from: { id: PROJECT_ID, slug: "shop" }, manifests_marked: 1, init_job: initJob },
    ]);
  });

  it("never hands an old state of shop a database billing now owns", async () => {
    const h = await setup();
    const db = await createSettled(h, PG);
    const moved = await move(h, db.id, "billing");
    await h.runtime.jobs.wait(null, v.parse(v.string(), moved.init_job?.id), 5);
    expect([
      liveAdapter(h.repo, PROJECT_ID, db.id),
      liveAdapter(h.repo, BILLING, db.id)?.id,
    ]).toEqual([null, db.id]);
  });

  it("makes an adapter read-only in Inspect, with no init, and refuses an ingest adapter there", async () => {
    const h = await setup();
    ensureInspectProject(h.projectsRepo, () => h.admin.id, h.now);
    const store = await createSettled(h, S3);
    const pushed = await createSettled(h, INGEST);
    const moved = await move(h, store.id, "inspect");
    expect([moved.adapter.mode, moved.init_job]).toEqual(["read_only", null]);
    await expect(move(h, pushed.id, "inspect")).rejects.toMatchObject({
      code: "PROJECT_READ_ONLY",
    });
  });

  it("refuses a taken name, a running job, the same project, and a project out of scope", async () => {
    const h = await setup();
    const store = await createSettled(h, S3);
    await h.adapters.create(h.qa, "billing", S3, TEST_META);
    const busy = await h.adapters.create(h.qa, "shop", { ...PG, name: "busy" }, TEST_META);
    expect([
      await codeOf(move(h, store.id, "billing")),
      await codeOf(move(h, busy.adapter.id, "billing")),
      await codeOf(move(h, store.id, "shop")),
      await codeOf(
        h.adapters.move({
          actor: h.qa,
          slug: "shop",
          adapterId: store.id,
          target: "billing",
          scope: [PROJECT_ID],
          meta: TEST_META,
        })
      ),
    ]).toEqual(["CONFLICT", "JOB_IN_PROGRESS", "VALIDATION_ERROR", "NOT_FOUND"]);
    // Refused before anything changed: both stay in shop.
    expect([h.repo.byId(store.id)?.project_id, h.repo.byId(busy.adapter.id)?.project_id]).toEqual([
      PROJECT_ID,
      PROJECT_ID,
    ]);
  });

  it("lets only the adapter's owner or an admin move it out of Inspect", async () => {
    const h = await setup();
    ensureInspectProject(h.projectsRepo, () => h.admin.id, h.now);
    const { adapter } = await h.adapters.create(h.qa, "inspect", S3_DRAFT, TEST_META);
    const sam: Actor = { ...h.qa, id: "01991f00-0000-7000-8000-0000000000b2", label: "sam" };
    await expect(move(h, adapter.id, "billing", sam, "inspect")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect((await move(h, adapter.id, "billing", h.admin, "inspect")).adapter.mode).toBe(
      "read_only"
    );
  });
});
