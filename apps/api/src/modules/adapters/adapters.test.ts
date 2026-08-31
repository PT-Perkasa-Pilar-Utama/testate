import { describe, expect, it } from "bun:test";
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

  it("forces storage adapters read-only with no init job", async () => {
    const { adapters, qa } = await createAdaptersHarness();
    const s3 = await adapters.create(qa, "shop", S3, TEST_META);
    expect(s3.adapter.mode).toBe("read_only");
    expect(s3.adapter.tier).toBe("files");
    expect(s3.init_job).toBeNull();
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
    ).rejects.toMatchObject({ code: "ADAPTER_UNREACHABLE" });
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

  it("lets qa tighten, only admin loosen, and refuses a mode on storage adapters", async () => {
    const { adapters, qa, admin } = await createAdaptersHarness();
    const { adapter } = await adapters.create(qa, "shop", PG, TEST_META);
    const tightened = await adapters.setMode(qa, "shop", adapter.id, "read_only", TEST_META);
    expect(tightened.mode).toBe("read_only");
    await expect(
      adapters.setMode(qa, "shop", adapter.id, "sandbox", TEST_META)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await adapters.setMode(admin, "shop", adapter.id, "sandbox", TEST_META)).mode).toBe(
      "sandbox"
    );
    const s3 = await adapters.create(qa, "shop", S3, TEST_META);
    await expect(
      adapters.setMode(admin, "shop", s3.adapter.id, "sandbox", TEST_META)
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
