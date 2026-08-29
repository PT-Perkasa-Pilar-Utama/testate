import { describe, expect, it } from "bun:test";
import { settingsSchema } from "@testate/shared";

import { TEST_META } from "../../../test/accounts.ts";
import { IDLE_SETTINGS_DEPS } from "../../../test/settings.ts";
import { PG, createAdaptersHarness, createSettled } from "../../../test/adapters.ts";
import type { AdaptersHarness } from "../../../test/adapters.ts";
import { expectContract } from "../../../test/contract.ts";
import { createMemoryBlobStore } from "../../lib/blobstore/index.ts";
import { createStoreMigrationRunner } from "./settings.migration.ts";
import { createSettingsRepository } from "./settings.repository.ts";
import { storedS3Target } from "./settings.store.ts";
import type { MigrationTarget } from "./settings.service.ts";
import { SETTINGS_MOCK, createSettingsService, leavesOf } from "./settings.service.ts";
import type { SettingsService } from "./settings.service.ts";

type Harness = { harness: AdaptersHarness; settings: SettingsService; rechecks: string[][] };

function s3Target(endpoint: string): MigrationTarget {
  return {
    driver: "s3",
    s3: {
      bucket: "snapshots",
      prefix: "testate",
      endpoint,
      virtual_hosted: false,
      access_key_id: "AKIA",
      secret_access_key: "s3cret",
    },
  };
}

function jobIdOf(job: { id: string } | null): string {
  if (job === null) throw new Error("no init job");
  return job.id;
}

async function createHarness(store: "local" | "s3" | undefined = undefined): Promise<Harness> {
  const harness = await createAdaptersHarness();
  const rechecks: string[][] = [];
  const settings = createSettingsService({
    repo: createSettingsRepository(harness.db),
    config: { TESTATE_MAX_UPLOAD_MB: 7, TESTATE_JOB_CONCURRENCY: 3, TESTATE_STORE: store },
    audit: harness.audit,
    ring: harness.ring,
    jobs: harness.runtime.jobs,
    netguard: {
      check: async (input) =>
        harness.blocked.has(input.host)
          ? { allowed: false, reason: "policy", matched: input.host }
          : { allowed: true, addresses: ["10.0.0.9"] },
    },
    recheckDenyList: async (deny) => {
      rechecks.push(deny);
      harness.blocked.add("pg.sit.internal");
      return harness.adapters.recheckDenyList();
    },
    retention: { db: harness.db, removeState: async () => undefined },
    now: harness.now,
  });
  return { harness, settings, rechecks };
}

describe("settings", () => {
  it("mock matches the contract", () => {
    expectContract(settingsSchema, SETTINGS_MOCK, (clone) => {
      clone["retention"] = { stash_keep: 0 };
    });
  });

  it("reads defaults with the environment's locked values laid over", async () => {
    const h = await createHarness("s3");
    const settings = await h.settings.get();
    expect(settings.limits).toMatchObject({
      upload_mb: 7,
      job_concurrency: 3,
      query_rows_max: 5000,
    });
    expect(settings.store).toMatchObject({ driver: "s3", locked_by_env: true });
    expect(settings.locked_by_env).toEqual([
      "limits.upload_mb",
      "limits.job_concurrency",
      "store.driver",
      "store.s3",
    ]);
  });

  it("persists a patch, refuses locked keys, and flattens nested keys", async () => {
    const h = await createHarness();
    const updated = await h.settings.update(
      h.harness.admin,
      { retention: { stash_keep: 2 }, quota: { default_bytes: 1 } },
      TEST_META
    );
    expect(updated.retention.stash_keep).toBe(2);
    expect((await h.settings.get()).quota.default_bytes).toBe(1);
    await expect(
      h.settings.update(h.harness.admin, { limits: { upload_mb: 99 } }, TEST_META)
    ).rejects.toThrow("limits.upload_mb is set by the environment");
    expect(leavesOf({ a: { b: 1 }, log: { sample_rate_by_route: { x: 0.5 } } })).toEqual([
      ["a.b", 1],
      ["log.sample_rate_by_route", { x: 0.5 }],
    ]);
  });

  it("a deny list change re-checks every adapter and disables the blocked ones", async () => {
    const h = await createHarness();
    const adapter = await createSettled(h.harness, PG);
    const result = await h.settings.update(
      h.harness.admin,
      { netguard: { deny: ["pg.sit.internal"] } },
      TEST_META
    );
    expect(h.rechecks).toEqual([["pg.sit.internal"]]);
    expect(result.disabled_adapters).toEqual([adapter.id]);
    expect((await h.harness.adapters.get("shop", adapter.id)).status).toBe("disabled");
    const same = await h.settings.update(
      h.harness.admin,
      { netguard: { deny: ["pg.sit.internal"] } },
      TEST_META
    );
    expect(same.disabled_adapters).toBeUndefined();
  });

  it("the retention sweep prunes old history, audit rows, and surplus stashes", async () => {
    const h = await createHarness();
    await createSettled(h.harness, PG);
    h.harness.db
      .query(
        "INSERT INTO query_history (id, adapter_id, query_hash, query_text, mode, created_at) VALUES ('q1', 'a', 'h', 'SELECT 1', 'read', '2020-01-01T00:00:00.000Z')"
      )
      .run();
    const removed: string[] = [];
    const settings = createSettingsService({
      repo: createSettingsRepository(h.harness.db),
      config: { TESTATE_MAX_UPLOAD_MB: 7, TESTATE_JOB_CONCURRENCY: 3, TESTATE_STORE: undefined },
      audit: h.harness.audit,
      ...IDLE_SETTINGS_DEPS,
      recheckDenyList: async () => [],
      retention: { db: h.harness.db, removeState: async (id) => void removed.push(id) },
      now: h.harness.now,
    });
    await settings.update(h.harness.admin, { retention: { stash_keep: 1 } }, TEST_META);
    for (const name of ["s1", "s2", "s3"]) {
      h.harness.db
        .query(
          "INSERT INTO states (id, project_id, name, kind, status, job_id, created_at, updated_at) SELECT ?, project_id, ?, 'stash', 'ready', 'j', ?, ? FROM states LIMIT 1"
        )
        .run(name, name, `2026-08-2${name.slice(-1)}T00:00:00.000Z`, "2026-08-29T00:00:00.000Z");
    }
    const report = await settings.runRetention();
    expect(report).toMatchObject({ query_history: 1, stashes: 2, import_runs: 0 });
    expect(removed).toEqual(["s2", "s1"]);
  });

  it('seals the S3 keys, shows them as markers, and keeps a key on "keep"', async () => {
    const h = await createHarness();
    const s3 = {
      bucket: "snapshots",
      prefix: "testate",
      region: null,
      endpoint: "http://minio.sit.internal:9000",
      virtual_hosted: false,
      access_key_id: "AKIA1",
      secret_access_key: "s3cret",
    };
    const updated = await h.settings.update(h.harness.admin, { store: { s3 } }, TEST_META);
    expect(updated.store.s3).toMatchObject({
      bucket: "snapshots",
      access_key_id: { set: true },
      secret_access_key: { set: true },
    });
    expect(JSON.stringify(updated)).not.toContain("s3cret");
    const values = createSettingsRepository(h.harness.db).all();
    expect(values.get("store.s3.secret_access_key")).not.toBe("s3cret");
    expect(await storedS3Target(values, h.harness.ring)).toMatchObject({
      secret_access_key: "s3cret",
    });
    await h.settings.update(
      h.harness.admin,
      { store: { s3: { ...s3, access_key_id: "AKIA2", secret_access_key: "keep" } } },
      TEST_META
    );
    expect(
      await storedS3Target(createSettingsRepository(h.harness.db).all(), h.harness.ring)
    ).toMatchObject({ access_key_id: "AKIA2", secret_access_key: "s3cret" });
    const locked = await createHarness("local");
    await expect(
      locked.settings.update(h.harness.admin, { store: { s3 } }, TEST_META)
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("migrates every referenced blob to the target store, flips the driver, and swaps the live store", async () => {
    const h = await createHarness();
    await createSettled(h.harness, PG);
    const before = h.harness.states.referencedBlobs();
    expect(before.length).toBeGreaterThan(0);
    const target = createMemoryBlobStore();
    h.harness.runtime.dispatcher.registerKind(
      "storage_migration",
      createStoreMigrationRunner({
        repo: createSettingsRepository(h.harness.db),
        ring: h.harness.ring,
        live: h.harness.blobs,
        stores: () => target,
        referencedBlobs: () => h.harness.states.referencedBlobs(),
        audit: h.harness.audit,
        now: h.harness.now,
      })
    );
    h.harness.blocked.add("blocked.sit.internal");
    await expect(
      h.settings.migrateStore(
        h.harness.admin,
        s3Target("http://blocked.sit.internal:9000"),
        TEST_META
      )
    ).rejects.toMatchObject({ code: "HOST_BLOCKED" });
    const job = await h.settings.migrateStore(
      h.harness.admin,
      s3Target("http://minio.sit.internal:9000"),
      TEST_META
    );
    const done = await h.harness.runtime.jobs.wait(null, job.id, 5);
    expect(done.error).toBeNull();
    expect(done.result).toEqual({ driver: "s3", copied: before.length, skipped: 0 });
    for (const hash of before) expect(await target.has(hash)).toBe(true);
    expect((await h.settings.get()).store.driver).toBe("s3");
    expect(h.harness.blobs.current()).toBe(target);
    const again = await h.settings.migrateStore(h.harness.admin, { driver: "local" }, TEST_META);
    const second = await h.harness.runtime.jobs.wait(null, again.id, 5);
    expect(second.result).toMatchObject({ driver: "local", copied: 0, skipped: before.length });
    const audit = h.harness.db
      .query("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'store.migrated'")
      .get();
    expect(audit).toEqual({ n: 2 });
  });

  it("refuses a store migration while a job runs or when the environment sets the store", async () => {
    const h = await createHarness();
    const { init_job } = await h.harness.adapters.create(h.harness.qa, "shop", PG, TEST_META);
    await expect(
      h.settings.migrateStore(h.harness.admin, { driver: "local" }, TEST_META)
    ).rejects.toMatchObject({ code: "JOB_IN_PROGRESS" });
    await h.harness.runtime.jobs.wait(null, jobIdOf(init_job), 5);
    const locked = await createHarness("s3");
    await expect(
      locked.settings.migrateStore(h.harness.admin, { driver: "local" }, TEST_META)
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
