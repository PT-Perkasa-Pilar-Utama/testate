import { describe, expect, it } from "bun:test";
import * as v from "valibot";

import { TEST_META } from "../../../test/accounts.ts";
import { PG, createAdaptersHarness, createSettled, fakeRegistry } from "../../../test/adapters.ts";
import { createTestSettings } from "../../../test/settings.ts";
import { createProjectsService } from "../projects/projects.service.ts";
import { returnToInit } from "./checkouts.return-to-init.ts";

const headRow = v.object({ head_status: v.string() });

describe("return to init", () => {
  it("adapter deletion restores the database to its init state before removing the row", async () => {
    const harness = await createAdaptersHarness();
    const adapter = await createSettled(harness, PG);
    const shop = harness.databases.get("shop");
    shop?.set("public.customers", [{ id: 9, email: "z@x.io" }]);
    shop?.set("public.orders", []);
    const plan = await harness.adapters.deletionPlan("shop", adapter.id);
    const job = await harness.adapters.remove(
      harness.qa,
      "shop",
      adapter.id,
      plan.plan_id,
      "restore",
      TEST_META
    );
    const done = await harness.runtime.jobs.wait(null, job.id, 5);
    expect(done.error).toBeNull();
    expect(done.status).toBe("succeeded");
    expect(done.result?.["restored"]).toEqual({ [adapter.id]: { tables: 2, batches: 2 } });
    expect(shop?.get("public.customers")).toEqual([
      { id: 1, email: "a@x.io" },
      { id: 2, email: "b@x.io" },
    ]);
    expect(shop?.get("public.orders")).toEqual([{ id: 1, customer_id: 1, total: "10.00" }]);
    await expect(harness.adapters.get("shop", adapter.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("project deletion restores every database first, edits and all", async () => {
    const harness = await createAdaptersHarness();
    const adapter = await createSettled(harness, PG);
    const projects = createProjectsService({
      repo: harness.projectsRepo,
      audit: harness.audit,
      settings: createTestSettings(harness.db, harness.audit, harness.now),
      adapters: harness.adapters,
      jobs: harness.runtime.jobs,
      now: harness.now,
    });
    // What a tester does: open a table and change it. Add a row, change a value, drop another.
    const shop = harness.databases.get("shop");
    shop?.set("public.customers", [
      { id: 1, email: "edited@x.io" },
      { id: 3, email: "new@x.io" },
    ]);
    shop?.set("public.orders", []);

    const plan = await projects.deletionPlan("shop");
    expect(plan.adapters.map((one) => one.action)).toStrictEqual(["restore"]);
    const job = await projects.deleteProject(
      harness.qa,
      "shop",
      {
        confirm_slug: "shop",
        plan_id: plan.plan_id,
        adapters: plan.adapters.map((one) => ({ adapter_id: one.adapter_id, action: "restore" })),
      },
      TEST_META
    );
    const done = await harness.runtime.jobs.wait(null, job.id, 5);
    expect(done.error).toBeNull();
    expect(done.status).toBe("succeeded");
    expect(done.result?.["restored"]).toEqual({ [adapter.id]: { tables: 2, batches: 2 } });
    // Back to what the adapter joined with: the edit, the addition and the deletion all undone.
    expect(shop?.get("public.customers")).toEqual([
      { id: 1, email: "a@x.io" },
      { id: 2, email: "b@x.io" },
    ]);
    expect(shop?.get("public.orders")).toEqual([{ id: 1, customer_id: 1, total: "10.00" }]);
    expect(harness.projectsRepo.bySlug("shop")).toBeNull();
  });

  it("a failed restore keeps the adapter, fails the job, and sets HEAD unknown", async () => {
    const harness = await createAdaptersHarness();
    const adapter = await createSettled(harness, PG);
    const plan = await harness.adapters.deletionPlan("shop", adapter.id);
    harness.databases.delete("shop");
    const job = await harness.adapters.remove(
      harness.qa,
      "shop",
      adapter.id,
      plan.plan_id,
      "restore",
      TEST_META
    );
    const done = await harness.runtime.jobs.wait(null, job.id, 5);
    expect(done.status).toBe("failed");
    expect(done.error?.code).toBe("ADAPTER_UNREACHABLE");
    expect((await harness.adapters.get("shop", adapter.id)).id).toBe(adapter.id);
    const head = v.parse(
      headRow,
      harness.db.query("SELECT head_status FROM projects WHERE id = ?").get(adapter.project_id)
    );
    expect(head.head_status).toBe("unknown");
  });

  it("refuses drift under restore and takes the intersection under force", async () => {
    const harness = await createAdaptersHarness();
    const adapter = await createSettled(harness, PG);
    harness.databases.get("shop")?.set("public.audit", [{ id: 1 }]);
    const deps = {
      engines: fakeRegistry({ databases: harness.databases }),
      blobs: harness.blobs,
      ring: harness.ring,
      adapters: harness.repo,
      states: harness.states,
    };
    await expect(
      returnToInit(deps, adapter.id, "restore", new AbortController().signal)
    ).rejects.toMatchObject({ code: "SCHEMA_DRIFT" });
    const forced = await returnToInit(deps, adapter.id, "force", new AbortController().signal);
    expect(forced.tables.length).toBe(2);
  });
});
