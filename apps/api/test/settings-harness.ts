import { createAdaptersHarness } from "./adapters.ts";
import type { AdaptersHarness } from "./adapters.ts";
import { createSettingsRepository } from "../src/modules/settings/settings.repository.ts";
import { createSettingsService } from "../src/modules/settings/settings.service.ts";
import type { MigrationTarget, SettingsService } from "../src/modules/settings/settings.service.ts";
import { createBackupRunner } from "../src/modules/settings/settings.backup.ts";
import { createStoreMigrationRunner } from "../src/modules/settings/settings.migration.ts";
import { createMemoryBlobStore } from "../src/lib/blobstore/index.ts";
import type { BlobStore } from "../src/lib/blobstore/index.ts";
import type { ReadEntry } from "../src/lib/snapshot/tar.ts";

export type Harness = { harness: AdaptersHarness; settings: SettingsService; rechecks: string[][] };

export function s3Target(endpoint: string): MigrationTarget {
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

export function registerStoreRunners(
  h: Harness,
  target: BlobStore = createMemoryBlobStore()
): void {
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
  h.harness.runtime.dispatcher.registerKind(
    "backup",
    createBackupRunner({
      db: h.harness.db,
      dataDir: h.harness.dataDir,
      version: "test",
      ring: h.harness.ring,
      live: h.harness.blobs,
      referencedBlobs: () => h.harness.states.referencedBlobs(),
      audit: h.harness.audit,
      now: h.harness.now,
    })
  );
}

export function entryOf(entries: ReadEntry[], name: string): ReadEntry {
  const entry = entries.find((item) => item.name === name);
  if (entry === undefined) throw new Error(`${name} is not in the tar`);
  return entry;
}

export function jobIdOf(job: { id: string } | null): string {
  if (job === null) throw new Error("no init job");
  return job.id;
}

export async function createSettingsHarness(
  store: "local" | "s3" | undefined = undefined
): Promise<Harness> {
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
    retention: { db: harness.db, removeState: async () => undefined, dataDir: harness.dataDir },
    now: harness.now,
  });
  return { harness, settings, rechecks };
}
