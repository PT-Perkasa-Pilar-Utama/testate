import { describe, expect, it } from "bun:test";
import * as v from "valibot";
import { adapterDeletionPlanSchema, adapterSchema, probeResultSchema } from "@testate/shared";

import { TEST_META } from "../../../test/accounts.ts";
import { PG, S3, createAdaptersHarness, storedSecrets } from "../../../test/adapters.ts";
import { expectContract } from "../../../test/contract.ts";
import {
  ADAPTER_DELETION_PLAN_MOCK,
  ADAPTER_MOCK,
  PROBE_MOCK,
  STORAGE_ADAPTER_MOCK,
} from "./adapters.mock.ts";

/** The shop project and its starting point, as rows: the gate under test reads both. */
function shopInit(harness: Awaited<ReturnType<typeof createAdaptersHarness>>) {
  const project = harness.projectsRepo.bySlug("shop");
  if (project === null) throw new Error("no shop project");
  const row = v.parse(
    v.object({ id: v.string() }),
    harness.db.query("SELECT id FROM states WHERE project_id = ? AND kind = 'init'").get(project.id)
  );
  return { projectId: project.id, initId: row.id };
}

describe("adapters", () => {
  it("mocks match the contract", () => {
    expectContract(adapterSchema, ADAPTER_MOCK, (clone) => {
      clone["credential"] = { set: true };
    });
    expectContract(adapterSchema, STORAGE_ADAPTER_MOCK, (clone) => {
      clone["tier"] = "bucket";
    });
    expectContract(probeResultSchema, PROBE_MOCK, (clone) => {
      clone["capabilities"] = {};
    });
    expectContract(adapterDeletionPlanSchema, ADAPTER_DELETION_PLAN_MOCK, (clone) => {
      clone["adapter"] = { action: "drop" };
    });
  });

  it("creates a database adapter with sealed secrets, probe columns, and an init job", async () => {
    const harness = await createAdaptersHarness();
    const { adapter, init_job } = await harness.adapters.create(harness.qa, "shop", PG, TEST_META);
    expect(adapter.tier).toBe("tabular");
    expect(adapter.mode).toBe("sandbox");
    expect(adapter.engine_version).toBe("16.3");
    expect(adapter.credential).toMatchObject({
      set: true,
      key_fingerprint: harness.ring.activeKid,
    });
    expect(adapter.readonly_credential).toStrictEqual({ set: false });
    expect(JSON.stringify(adapter)).not.toContain("pg-secret");
    expect(init_job?.kind).toBe("snapshot");
    expect(await storedSecrets(harness, adapter.id)).toStrictEqual({ password: "pg-secret" });
  });

  it("lets a database join only while every database holds the starting point", async () => {
    const harness = await createAdaptersHarness();
    await harness.adapters.create(harness.qa, "shop", PG, TEST_META);
    const { projectId, initId } = shopInit(harness);
    // HEAD on init, then the databases move off it: a second one may not join until a checkout.
    harness.projectsRepo.setHead(projectId, initId, "at_state", new Date().toISOString());
    harness.projectsRepo.markHeadDirty(projectId, true, new Date().toISOString());
    await expect(
      harness.adapters.create(harness.qa, "shop", { ...PG, name: "pg-two" }, TEST_META)
    ).rejects.toThrow("check out the starting point first");
    harness.projectsRepo.markHeadDirty(projectId, false, new Date().toISOString());
    const { adapter } = await harness.adapters.create(
      harness.qa,
      "shop",
      { ...PG, name: "pg-two" },
      TEST_META
    );
    expect(adapter.name).toBe("pg-two");
    // A file store never enters a state, so it joins whenever.
    harness.projectsRepo.markHeadDirty(projectId, true, new Date().toISOString());
    await expect(harness.adapters.create(harness.qa, "shop", S3, TEST_META)).resolves.toBeDefined();
  });

  it("leaves a storage adapter read-only unless asked, and never takes an init state", async () => {
    const { adapters, qa } = await createAdaptersHarness();
    const { mode: _asked, ...unasked } = S3;
    const quiet = await adapters.create(qa, "shop", unasked, TEST_META);
    expect(quiet.adapter.mode).toBe("read_only");
    expect(quiet.adapter.tier).toBe("files");
    // A file store has no rows to snapshot, whichever mode it is in.
    expect(quiet.init_job).toBeNull();
    const asked = await adapters.create(qa, "shop", { ...S3, name: "scratch" }, TEST_META);
    expect(asked.adapter.mode).toBe("sandbox");
    expect(asked.init_job).toBeNull();
  });

  it("refuses a kind that does not match the engine, unknown or missing secrets, and a taken name", async () => {
    const { adapters, qa } = await createAdaptersHarness();
    await expect(
      adapters.create(qa, "shop", { ...PG, kind: "storage" }, TEST_META)
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      adapters.create(qa, "shop", { ...PG, secrets: { token: "x" } }, TEST_META)
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", details: { key: "token" } });
    await expect(
      adapters.create(qa, "shop", { ...PG, secrets: {} }, TEST_META)
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      adapters.create(qa, "shop", { ...PG, config: { host: "x" } }, TEST_META)
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await adapters.create(qa, "shop", PG, TEST_META);
    await expect(
      adapters.create(qa, "shop", { ...PG, name: "Orders-DB" }, TEST_META)
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("checks the address before probing and refuses engines below the floor", async () => {
    const { adapters, qa, blocked } = await createAdaptersHarness();
    blocked.add("pg.prod.internal");
    await expect(
      adapters.testDraft("shop", { ...PG, config: { ...PG.config, host: "pg.prod.internal" } })
    ).rejects.toMatchObject({ code: "HOST_BLOCKED", details: { reason: "policy" } });
    await expect(
      adapters.testDraft("shop", { ...PG, config: { ...PG.config, host: "gone.invalid" } })
    ).rejects.toMatchObject({
      code: "ADAPTER_UNREACHABLE",
      message: expect.stringContaining("does not resolve"),
    });
    await expect(
      adapters.testDraft("shop", { ...PG, config: { ...PG.config, database: "ancient" } })
    ).rejects.toMatchObject({ code: "ENGINE_UNSUPPORTED", details: { floor: "13" } });
    await expect(adapters.testDraft("shop", PG)).resolves.toMatchObject({ meets_floor: true });
    await expect(adapters.testDraft("shop", S3)).resolves.toMatchObject({
      reachable: true,
      tier: "files",
    });
    await expect(
      adapters.create(
        qa,
        "shop",
        { ...PG, config: { ...PG.config, host: "pg.prod.internal" } },
        TEST_META
      )
    ).rejects.toMatchObject({ code: "HOST_BLOCKED" });
  });

  it("warns when another adapter already tracks the same database", async () => {
    const { adapters, qa } = await createAdaptersHarness();
    // A fresh target is nobody else's business.
    expect((await adapters.testDraft("shop", PG)).warnings).toStrictEqual([]);
    await adapters.create(qa, "shop", { ...PG, name: "shop-db" }, TEST_META);

    // The same database again, under any name: two adapters on one target do not serialise.
    const again = await adapters.testDraft("shop", { ...PG, name: "second-look" });
    expect(again.warnings.map((warning) => warning.code)).toStrictEqual(["target_shared"]);
    expect(again.warnings[0]?.message).toContain("shop/shop-db");
  });

  it("lists by project with filters and hides other projects", async () => {
    const { adapters, qa } = await createAdaptersHarness();
    await adapters.create(qa, "shop", PG, TEST_META);
    await adapters.create(qa, "shop", S3, TEST_META);
    expect((await adapters.list("shop", {})).map((a) => a.name)).toStrictEqual([
      "exports",
      "orders-db",
    ]);
    expect((await adapters.list("shop", { kind: "storage" })).map((a) => a.name)).toStrictEqual([
      "exports",
    ]);
    expect((await adapters.list("shop", { engine: "mysql" })).length).toBe(0);
    await expect(adapters.list("nope", {})).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lets only an admin change the mode, on a file store as much as on a database", async () => {
    const { adapters, qa, admin } = await createAdaptersHarness();
    const { adapter } = await adapters.create(qa, "shop", PG, TEST_META);
    // A tester picks the mode at creation and never again: tightening used to be theirs too.
    await expect(
      adapters.setMode(qa, "shop", adapter.id, "read_only", TEST_META)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const tightened = await adapters.setMode(admin, "shop", adapter.id, "read_only", TEST_META);
    expect(tightened.mode).toBe("read_only");
    await expect(
      adapters.setMode(qa, "shop", adapter.id, "sandbox", TEST_META)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await adapters.setMode(admin, "shop", adapter.id, "sandbox", TEST_META)).mode).toBe(
      "sandbox"
    );
    // A file store's mode is the gate on uploading, deleting and renaming a file, so it has to be
    // changeable. It used to be refused here, which left a store stuck on whatever it was made
    // with: one made read-only could never be written to and one made sandbox never protected.
    const s3 = await adapters.create(qa, "shop", S3, TEST_META);
    expect(
      (await adapters.setMode(admin, "shop", s3.adapter.id, "read_only", TEST_META)).mode
    ).toBe("read_only");
    await expect(
      adapters.setMode(qa, "shop", s3.adapter.id, "sandbox", TEST_META)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await adapters.setMode(admin, "shop", s3.adapter.id, "sandbox", TEST_META)).mode).toBe(
      "sandbox"
    );
  });
});
