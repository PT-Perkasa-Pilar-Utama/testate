import { describe, expect, it } from "bun:test";
import { checkoutSchema, preflightSchema } from "@testate/shared";
import type { Checkout, Job } from "@testate/shared";

import { TEST_META } from "../../../test/accounts.ts";
import { PG, createAdaptersHarness, createSettled, shopDatabase } from "../../../test/adapters.ts";
import type { AdaptersHarness } from "../../../test/adapters.ts";
import { expectContract } from "../../../test/contract.ts";
import { CHECKOUT_MOCK, PREFLIGHT_MOCK } from "./checkouts.mock.ts";
import { createCheckoutsService } from "./checkouts.service.ts";
import type { CheckoutsService } from "./checkouts.service.ts";

type Harness = { harness: AdaptersHarness; checkouts: CheckoutsService };

async function createCheckoutsHarness(): Promise<Harness> {
  const harness = await createAdaptersHarness();
  const checkouts = createCheckoutsService({
    engines: harness.engines,
    blobs: harness.blobs,
    ring: harness.ring,
    adapters: harness.repo,
    states: harness.states,
    repo: harness.checkouts,
    projects: harness.projectsRepo,
    jobs: harness.runtime.jobs,
    audit: harness.audit,
    now: harness.now,
  });
  return { harness, checkouts };
}

/** Mutates the fake shop database so a restore has something to undo. */
function scribble(harness: AdaptersHarness): void {
  harness.databases.get("shop")?.set("public.customers", [{ id: 9, email: "z@x.io" }]);
}

function stashOf(checkout: Checkout): string {
  if (checkout.stash_state_id === null) throw new Error("no stash was taken");
  return checkout.stash_state_id;
}

async function settled(h: Harness, started: { checkout: Checkout; job: Job }): Promise<Checkout> {
  await h.harness.runtime.jobs.wait(null, started.job.id, 5);
  return h.checkouts.get("shop", started.checkout.id);
}

async function checkoutInit(h: Harness, force = false): Promise<{ checkout: Checkout; job: Job }> {
  return h.checkouts.create(h.harness.qa, "shop", { state_name: "init", force }, TEST_META);
}

describe("checkouts", () => {
  it("mocks match the contract", () => {
    expectContract(checkoutSchema, CHECKOUT_MOCK, (clone) => {
      clone["status"] = "done";
    });
    expectContract(preflightSchema, PREFLIGHT_MOCK, (clone) => {
      clone["adapters"] = [{ adapter_id: "x" }];
    });
  });

  it("stashes first, restores every adapter, records results, and moves HEAD to the state", async () => {
    const h = await createCheckoutsHarness();
    const adapter = await createSettled(h.harness, PG);
    scribble(h.harness);
    const started = await checkoutInit(h);
    expect(started.checkout.status).toBe("running");
    expect(started.job.kind).toBe("checkout");
    const done = await settled(h, started);
    expect(done.status).toBe("succeeded");
    expect(done.adapters[0]).toMatchObject({ adapter_id: adapter.id, result: "restored", rows: 3 });
    const stash = h.harness.states.byIdOrName(adapter.project_id, stashOf(done));
    expect(stash).toMatchObject({ kind: "stash", stash_reason: "checkout", status: "ready" });
    expect(h.harness.databases.get("shop")?.get("public.customers")).toEqual([
      { id: 1, email: "a@x.io" },
      { id: 2, email: "b@x.io" },
    ]);
    expect(h.harness.projectsRepo.bySlug("shop")?.head).toMatchObject({
      state_name: "init",
      status: "at_state",
    });
    expect((await h.checkouts.list("shop", { limit: 10 })).map((item) => item.id)).toEqual([
      done.id,
    ]);
  });

  it("skips a drifted adapter unless forced, and sets HEAD unknown on a partial result", async () => {
    const h = await createCheckoutsHarness();
    await createSettled(h.harness, PG);
    h.harness.databases.get("shop")?.set("public.audit", [{ id: 1 }]);
    const preflight = await h.checkouts.preflight("shop", { state_name: "init", force: true });
    expect(preflight.adapters[0]?.drift?.tables.added).toEqual(["public.audit"]);
    expect(preflight.adapters[0]?.force_preview).toBeDefined();
    const refused = await settled(h, await checkoutInit(h));
    expect(refused.status).toBe("failed");
    expect(refused.adapters[0]).toMatchObject({
      result: "skipped",
      error: { code: "SCHEMA_DRIFT" },
    });
    expect(h.harness.projectsRepo.bySlug("shop")?.head.status).toBe("unknown");
    const forced = await settled(h, await checkoutInit(h, true));
    expect(forced.status).toBe("succeeded");
    expect(forced.force).toBe(true);
  });

  it("refuses read-only adapters and states that are not ready", async () => {
    const h = await createCheckoutsHarness();
    const adapter = await createSettled(h.harness, PG);
    await h.harness.adapters.setMode(h.harness.qa, "shop", adapter.id, "read_only", TEST_META);
    await expect(checkoutInit(h)).rejects.toMatchObject({ code: "ADAPTER_READ_ONLY" });
    await expect(
      h.checkouts.create(h.harness.qa, "shop", { state_name: "missing", force: false }, TEST_META)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("retries the adapters that did not restore after a failed run", async () => {
    const h = await createCheckoutsHarness();
    await createSettled(h.harness, PG);
    h.harness.databases.delete("shop");
    const first = await settled(h, await checkoutInit(h));
    expect(first.status).toBe("failed");
    expect(first.adapters[0]?.result).toBe("pending");
    expect(first.stash_state_id).toBeNull();
    h.harness.databases.set("shop", shopDatabase());
    const fixed = await settled(
      h,
      await h.checkouts.retry(h.harness.qa, "shop", first.id, TEST_META)
    );
    expect(fixed.status).toBe("succeeded");
    expect(fixed.adapters[0]?.result).toBe("restored");
    await expect(h.checkouts.retry(h.harness.qa, "shop", first.id, TEST_META)).rejects.toThrow(
      "nothing to retry"
    );
  });

  it("reports failed counters and repairs them into a restored checkout", async () => {
    const h = await createCheckoutsHarness();
    await createSettled(h.harness, PG);
    h.harness.failCounters.current = true;
    const broken = await settled(h, await checkoutInit(h));
    expect(broken.status).toBe("failed");
    expect(broken.adapters[0]?.result).toBe("counters_failed");
    expect((await h.checkouts.counters("shop", broken.id)).adapters[0]?.counters).toEqual([
      { name: "orders_id_seq", ok: false, error: "fake" },
    ]);
    const repaired = await h.checkouts.repairCounters(h.harness.qa, "shop", broken.id, TEST_META);
    expect(repaired.adapters[0]?.counters).toEqual([{ name: "orders_id_seq", ok: true }]);
    const after = await h.checkouts.get("shop", broken.id);
    expect(after.status).toBe("succeeded");
    expect(h.harness.projectsRepo.bySlug("shop")?.head.status).toBe("at_state");
    await expect(
      h.checkouts.repairCounters(h.harness.qa, "shop", broken.id, TEST_META)
    ).rejects.toThrow("nothing to repair");
  });

  it("terminates blocking sessions through the engine when the probe allows and audits it", async () => {
    const h = await createCheckoutsHarness();
    const adapter = await createSettled(h.harness, PG);
    const checkout = await settled(h, await checkoutInit(h));
    const result = await h.checkouts.terminateBlockers(
      h.harness.qa,
      "shop",
      checkout.id,
      adapter.id,
      ["101", "dead-7"],
      TEST_META
    );
    expect(result).toEqual({ terminated: ["101"], failed: ["dead-7"] });
    const audit = h.harness.db
      .query("SELECT outcome FROM audit_logs WHERE action = 'checkout.blockers_terminated'")
      .all();
    expect(audit).toEqual([{ outcome: "partial" }]);
    h.harness.db
      .query(
        "UPDATE adapters SET capabilities = json_set(capabilities, '$.canTerminateSessions', json('false')) WHERE id = ?"
      )
      .run(adapter.id);
    await expect(
      h.checkouts.terminateBlockers(h.harness.qa, "shop", checkout.id, adapter.id, ["1"], TEST_META)
    ).rejects.toMatchObject({ code: "ENGINE_UNSUPPORTED", details: { reason: "capability" } });
  });
});
