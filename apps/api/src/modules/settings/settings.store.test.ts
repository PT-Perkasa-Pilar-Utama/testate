import { describe, expect, it } from "bun:test";
import type { JsonObject } from "@testate/shared";
import * as v from "valibot";

import { TEST_META } from "../../../test/accounts.ts";
import { PG, createSettled } from "../../../test/adapters.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  createSettingsHarness,
  entryOf,
  jobIdOf,
  registerStoreRunners,
  s3Target,
} from "../../../test/settings-harness.ts";
import { createMemoryBlobStore } from "../../lib/blobstore/index.ts";
import { readTar } from "../../lib/snapshot/tar.ts";
import { createSettingsRepository } from "./settings.repository.ts";
import { storedS3Target } from "./settings.store.ts";

describe("settings store", () => {
  it('seals the S3 keys, shows them as markers, and keeps a key on "keep"', async () => {
    const h = await createSettingsHarness();
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
    const locked = await createSettingsHarness("local");
    await expect(
      locked.settings.update(h.harness.admin, { store: { s3 } }, TEST_META)
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("writes the S3 keys and their set_at in one transaction", async () => {
    const h = await createSettingsHarness();
    const repo = createSettingsRepository(h.harness.db);
    await h.settings.update(
      h.harness.admin,
      {
        store: {
          s3: {
            bucket: "snapshots",
            prefix: "testate",
            region: null,
            endpoint: "http://minio.sit.internal:9000",
            virtual_hosted: false,
            access_key_id: "AKIA1",
            secret_access_key: "s3cret",
          },
        },
      },
      TEST_META
    );
    // A reader that saw a sealed key without its set_at answered 500 on GET /settings.
    expect(repo.all().get("store.s3.set_at")).toEqual(expect.any(String));

    const circular: JsonObject = {};
    circular["self"] = circular;
    expect(() =>
      repo.setMany(
        [
          ["probe.one", 1],
          ["probe.two", circular],
        ],
        null,
        "2026-01-01T00:00:00.000Z"
      )
    ).toThrow("cyclic");
    expect(repo.all().get("probe.one")).toBeUndefined();
  });

  it("migrates every referenced blob to the target store, flips the driver, and swaps the live store", async () => {
    const h = await createSettingsHarness();
    await createSettled(h.harness, PG);
    const before = h.harness.states.referencedBlobs();
    expect(before.length).toBeGreaterThan(0);
    const target = createMemoryBlobStore();
    registerStoreRunners(h, target);
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
    const h = await createSettingsHarness();
    const { init_job } = await h.harness.adapters.create(h.harness.qa, "shop", PG, TEST_META);
    await expect(
      h.settings.migrateStore(h.harness.admin, { driver: "local" }, TEST_META)
    ).rejects.toMatchObject({ code: "JOB_IN_PROGRESS" });
    await h.harness.runtime.jobs.wait(null, jobIdOf(init_job), 5);
    const locked = await createSettingsHarness("s3");
    await expect(
      locked.settings.migrateStore(h.harness.admin, { driver: "local" }, TEST_META)
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("backs up metadata and blobs to a download tar that expires after a day", async () => {
    const h = await createSettingsHarness();
    await createSettled(h.harness, PG);
    registerStoreRunners(h);
    const job = await h.settings.backup(
      h.harness.admin,
      { include_blobs: true, destination: "download" },
      TEST_META
    );
    const done = await h.harness.runtime.jobs.wait(null, job.id, 5);
    expect(done.error).toBeNull();
    expect(done.result).toMatchObject({ key_fingerprints: [h.harness.ring.activeKid] });
    const file = await h.settings.backupFile(job.id);
    const entries = [...readTar(new Uint8Array(await new Response(file.stream).arrayBuffer()))];
    const names = entries.map((entry) => entry.name);
    expect(names.slice(0, 2)).toEqual(["manifest.json", "metadata.db"]);
    expect(names.length).toBe(2 + h.harness.states.referencedBlobs().length);
    const manifest = JSON.parse(new TextDecoder().decode(entryOf(entries, "manifest.json").bytes));
    expect(manifest).toMatchObject({
      version: 1,
      include_blobs: true,
      blob_count: names.length - 2,
    });
    expect(new TextDecoder().decode(entryOf(entries, "metadata.db").bytes.slice(0, 15))).toBe(
      "SQLite format 3"
    );
    expect(existsSync(join(h.harness.dataDir, "run", `backup-${job.id}.db`))).toBe(false);
    h.harness.advance(25 * 60 * 60 * 1000);
    await expect(h.settings.backupFile(job.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("stores a backup in the snapshot store and refuses a second one while it runs", async () => {
    const h = await createSettingsHarness();
    registerStoreRunners(h);
    const job = await h.settings.backup(
      h.harness.admin,
      { include_blobs: false, destination: "store" },
      TEST_META
    );
    await expect(
      h.settings.backup(h.harness.admin, { include_blobs: false, destination: "store" }, TEST_META)
    ).rejects.toMatchObject({ code: "JOB_IN_PROGRESS" });
    const done = await h.harness.runtime.jobs.wait(null, job.id, 5);
    const result = v.parse(
      v.object({ store_key: v.string(), size_bytes: v.number() }),
      done.result
    );
    expect(await h.harness.blobs.has(result.store_key.slice(-64))).toBe(true);
    await expect(h.settings.backupFile(job.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const audit = h.harness.db
      .query("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'backup.created'")
      .get();
    expect(audit).toEqual({ n: 1 });
  });
});
