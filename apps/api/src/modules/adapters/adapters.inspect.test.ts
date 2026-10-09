import { describe, expect, it } from "bun:test";
import type { Actor } from "@testate/shared";

import { TEST_META } from "../../../test/accounts.ts";
import { PG, S3, createAdaptersHarness } from "../../../test/adapters.ts";
import type { AdaptersHarness } from "../../../test/adapters.ts";
import { createDataHarness } from "../../../test/data-harness.ts";
import { ensureInspectProject } from "../projects/projects.inspect.ts";

// #56, Q3b and Q5 (docs/decisions/2026-10-09-inspect-project.md): adapters in the Inspect project.
const REFUSED = { code: "PROJECT_READ_ONLY" };
// The fixtures ask for sandbox; the Inspect form sends no mode at all.
const { mode: _pgMode, ...PG_DRAFT } = PG;
const { mode: _s3Mode, ...S3_DRAFT } = S3;
const NOT_OWNER = { code: "FORBIDDEN", details: { reason: "not_adapter_owner" } };

/** A second tester, who did not add the adapter. */
function otherTester(h: AdaptersHarness): Actor {
  return { ...h.qa, id: "01991f00-0000-7000-8000-0000000000b2", label: "sam" };
}

async function withInspect(): Promise<AdaptersHarness> {
  const h = await createAdaptersHarness();
  ensureInspectProject(h.projectsRepo, () => h.admin.id, h.now);
  return h;
}

describe("adapters in the Inspect project", () => {
  it("are read-only, take no init snapshot, and remember who added them", async () => {
    const h = await withInspect();
    const { adapter, init_job } = await h.adapters.create(h.qa, "inspect", PG_DRAFT, TEST_META);
    expect(adapter.mode).toBe("read_only");
    expect(init_job).toBeNull();
    expect(h.states.latestInit(adapter.id)).toBeNull();
    expect(adapter.created_by).toBe(h.qa.id);
    expect(adapter.created_by_label).not.toBeNull();
  });

  it("refuse a sandbox on create and any mode change, for an admin too", async () => {
    const h = await withInspect();
    await expect(
      h.adapters.create(h.qa, "inspect", { ...S3_DRAFT, mode: "sandbox" }, TEST_META)
    ).rejects.toMatchObject(REFUSED);
    const { adapter } = await h.adapters.create(h.qa, "inspect", S3_DRAFT, TEST_META);
    await expect(
      h.adapters.setMode(h.admin, "inspect", adapter.id, "sandbox", TEST_META)
    ).rejects.toMatchObject(REFUSED);
  });

  it("are changed or removed only by whoever added them, or an admin", async () => {
    const h = await withInspect();
    const { adapter } = await h.adapters.create(h.qa, "inspect", PG_DRAFT, TEST_META);
    const rename = (actor: Actor, name: string) =>
      h.adapters.update(actor, "inspect", adapter.id, { name }, TEST_META);
    await expect(rename(otherTester(h), "taken-over")).rejects.toMatchObject(NOT_OWNER);
    await expect(rename(h.qa, "mine")).resolves.toBeDefined();
    await expect(rename(h.admin, "admins-too")).resolves.toBeDefined();
    const plan = await h.adapters.deletionPlan("inspect", adapter.id);
    await expect(
      h.adapters.remove(otherTester(h), "inspect", adapter.id, plan.plan_id, "skip", TEST_META)
    ).rejects.toMatchObject(NOT_OWNER);
  });

  it("an adapter in a regular project stays anyone's to change (Q3c)", async () => {
    const h = await createAdaptersHarness();
    const { adapter } = await h.adapters.create(h.qa, "shop", S3, TEST_META);
    expect(adapter.created_by).toBe(h.qa.id);
    const renamed = await h.adapters.update(
      otherTester(h),
      "shop",
      adapter.id,
      { name: "shared" },
      TEST_META
    );
    expect(renamed.adapter.name).toBe("shared");
  });

  it("column masks on someone's Inspect adapter are theirs to change", async () => {
    const h = await createDataHarness();
    h.harness.db.query("UPDATE projects SET kind = 'inspect' WHERE slug = 'shop'").run();
    const mask = { required_function: null, mask: "redact", display: false } as const;
    const put = (actor: Actor) =>
      h.data.upsertPolicy(actor, h.adapterId, "public.customers", "email", mask, TEST_META);
    await expect(put(otherTester(h.harness))).rejects.toMatchObject(NOT_OWNER);
    await expect(put(h.harness.qa)).resolves.toBeDefined();
    await expect(
      h.data.removePolicy(
        otherTester(h.harness),
        h.adapterId,
        "public.customers",
        "email",
        TEST_META
      )
    ).rejects.toMatchObject(NOT_OWNER);
  });
});
