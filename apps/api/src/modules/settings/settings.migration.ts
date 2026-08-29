import * as v from "valibot";

import type { BlobStore, SwitchableBlobStore } from "../../lib/blobstore/index.ts";
import { conflict } from "../../lib/http/index.ts";
import type { KeyRing } from "../../lib/sealed/index.ts";
import type { AuditService } from "../audit/audit.service.ts";
import type { JobRunner } from "../jobs/jobs.dispatcher.ts";
import type { SettingsRepository } from "./settings.repository.ts";
import { storedS3Target } from "./settings.store.ts";
import type { StoreFactory, StoreTarget } from "./settings.store.ts";

export type MigrationDeps = {
  repo: SettingsRepository;
  ring: KeyRing;
  live: SwitchableBlobStore;
  stores: StoreFactory;
  referencedBlobs: () => string[];
  audit: AuditService;
  now: () => Date;
};

export const migrationPayloadSchema = v.object({ target_driver: v.picklist(["local", "s3"]) });

async function copyBlob(source: BlobStore, target: BlobStore, hash: string): Promise<boolean> {
  if (await target.has(hash)) return false;
  await target.put(source.get(hash), { expectedHash: hash });
  return true;
}

/**
 * The `storage_migration` job (15 §15.7): copy every referenced blob with hash verification, write
 * the marker, flip `store.driver`, and swap the live store. The source stays until an admin deletes it.
 * Re-running skips blobs the target already holds.
 */
export function createStoreMigrationRunner(deps: MigrationDeps): JobRunner {
  return async ({ job, progress, signal }) => {
    const payload = v.parse(migrationPayloadSchema, job.payload);
    const values = deps.repo.all();
    const target: StoreTarget =
      payload.target_driver === "local"
        ? { driver: "local" }
        : { driver: "s3", s3: await requireS3(values, deps.ring) };
    const store = deps.stores(target);
    const hashes = deps.referencedBlobs();
    let copied = 0;
    let skipped = 0;
    for (const [index, hash] of hashes.entries()) {
      if (signal.aborted) throw conflict("store migration interrupted before the flip");
      if (await copyBlob(deps.live.current(), store, hash)) copied += 1;
      else skipped += 1;
      progress({ phase: "copy", done: index + 1, total: hashes.length });
    }
    const at = deps.now().toISOString();
    deps.repo.set(
      "store.migration_marker",
      { job_id: job.id, driver: target.driver, at },
      job.actor.id,
      at
    );
    deps.repo.set("store.driver", target.driver, job.actor.id, at);
    deps.live.swap(store);
    deps.audit.record({
      actor: job.actor,
      action: "store.migrated",
      target_type: "settings",
      target_id: "store",
      details: { driver: target.driver, copied, skipped },
      outcome: "succeeded",
    });
    return { status: "succeeded", result: { driver: target.driver, copied, skipped } };
  };
}

async function requireS3(values: ReturnType<SettingsRepository["all"]>, ring: KeyRing) {
  const s3 = await storedS3Target(values, ring);
  if (s3 === null) throw conflict("store.s3 is not configured");
  return s3;
}
