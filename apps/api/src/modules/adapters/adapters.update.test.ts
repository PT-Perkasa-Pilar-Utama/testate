import { describe, expect, it } from "bun:test";

import { TEST_META } from "../../../test/accounts.ts";
import { PG, S3, createAdaptersHarness, storedSecrets } from "../../../test/adapters.ts";
import { PLAN_TTL_MS, mergeSecrets } from "./adapters.service.ts";

describe("adapter updates", () => {
  it("renames without a new init state, re-inits on a target change, and tracks credential replacement", async () => {
    const harness = await createAdaptersHarness();
    const { adapters, qa, audit } = harness;
    const { adapter } = await adapters.create(qa, "shop", PG, TEST_META);
    const renamed = await adapters.update(qa, "shop", adapter.id, { name: "orders" }, TEST_META);
    expect(renamed.adapter.name).toBe("orders");
    expect(renamed.init_job).toBeNull();
    const moved = await adapters.update(
      qa,
      "shop",
      adapter.id,
      { config: { ...PG.config, host: "pg2.sit.internal" }, secrets: { password: "keep" } },
      TEST_META
    );
    expect(moved.init_job?.kind).toBe("snapshot");
    expect(moved.adapter.config["host"]).toBe("pg2.sit.internal");
    expect(await storedSecrets(harness, adapter.id)).toStrictEqual({ password: "pg-secret" });
    const replaced = await adapters.update(
      qa,
      "shop",
      adapter.id,
      { secrets: { password: "new-secret" } },
      TEST_META
    );
    expect(replaced.init_job).toBeNull();
    expect(await storedSecrets(harness, adapter.id)).toStrictEqual({ password: "new-secret" });
    const actions = (await audit.list({ limit: 10, action: "adapter." })).rows.map((r) => r.action);
    expect(actions).toStrictEqual([
      "adapter.credential_replaced",
      "adapter.updated",
      "adapter.updated",
      "adapter.created",
    ]);
    expect((await audit.list({ limit: 1 })).rows[0]?.adapter).toStrictEqual({
      id: adapter.id,
      name: "orders",
    });
  });

  it("seals and removes the read-only credential", async () => {
    const { adapters, qa } = await createAdaptersHarness();
    const { adapter } = await adapters.create(
      qa,
      "shop",
      { ...PG, readonly_secrets: { password: "ro" } },
      TEST_META
    );
    expect(adapter.readonly_credential.set).toBe(true);
    const cleared = await adapters.update(
      qa,
      "shop",
      adapter.id,
      { readonly_secrets: null },
      TEST_META
    );
    expect(cleared.adapter.readonly_credential).toStrictEqual({ set: false });
  });

  it("retests with the stored secrets and disables the adapter when the policy now blocks it", async () => {
    const { adapters, qa, blocked, advance } = await createAdaptersHarness();
    const { adapter } = await adapters.create(qa, "shop", PG, TEST_META);
    advance(60_000);
    await expect(adapters.retest(qa, "shop", adapter.id, TEST_META)).resolves.toMatchObject({
      meets_floor: true,
    });
    expect((await adapters.get("shop", adapter.id)).last_probe_at).toBe("2026-08-28T08:01:00.000Z");
    blocked.add("pg.sit.internal");
    await expect(adapters.retest(qa, "shop", adapter.id, TEST_META)).rejects.toMatchObject({
      code: "HOST_BLOCKED",
    });
    expect(await adapters.get("shop", adapter.id)).toMatchObject({
      status: "disabled",
      status_message: "policy",
    });
  });

  it("plans a deletion, refuses stale plans and disallowed actions, and queues the job", async () => {
    const { adapters, qa, advance } = await createAdaptersHarness();
    const { adapter } = await adapters.create(qa, "shop", PG, TEST_META);
    const plan = await adapters.deletionPlan("shop", adapter.id);
    expect(plan.adapter.action).toBe("restore");
    expect(plan.states_referencing).toBe(0);
    await expect(
      adapters.remove(qa, "shop", adapter.id, plan.plan_id, "force", TEST_META)
    ).rejects.toMatchObject({ code: "CONFLICT", details: { action: "force" } });
    const job = await adapters.remove(qa, "shop", adapter.id, plan.plan_id, "restore", TEST_META);
    expect(job.kind).toBe("adapter_delete");
    await expect(
      adapters.remove(qa, "shop", adapter.id, plan.plan_id, "restore", TEST_META)
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const late = await adapters.deletionPlan("shop", adapter.id);
    advance(PLAN_TTL_MS + 1);
    await expect(
      adapters.remove(qa, "shop", adapter.id, late.plan_id, "restore", TEST_META)
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const s3 = await adapters.create(qa, "shop", S3, TEST_META);
    expect((await adapters.deletionPlan("shop", s3.adapter.id)).adapter).toMatchObject({
      action: "skip",
      reason: "read_only",
    });
  });

  it("merges patch secrets with keep semantics", () => {
    expect(mergeSecrets({ password: "old", extra: "x" }, { password: "keep" })).toStrictEqual({
      password: "old",
    });
    expect(mergeSecrets({ password: "old" }, { password: "new" })).toStrictEqual({
      password: "new",
    });
    expect(mergeSecrets({ password: "old" }, undefined)).toStrictEqual({ password: "old" });
    expect(mergeSecrets({}, { password: "keep" })).toStrictEqual({});
  });
});
