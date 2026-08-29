import type { Config } from "./lib/config/index.ts";
import type { MetadataDb } from "./lib/db/index.ts";
import type { KeyRing } from "./lib/sealed/index.ts";
import type { AuditService } from "./modules/audit/audit.service.ts";
import type { Dispatcher } from "./modules/jobs/jobs.dispatcher.ts";
import type { JobsService } from "./modules/jobs/jobs.service.ts";
import type { ProjectsRepository } from "./modules/projects/projects.repository.ts";
import { createBackupRunner } from "./modules/settings/settings.backup.ts";
import { createStoreMigrationRunner } from "./modules/settings/settings.migration.ts";
import { createSettingsRepository } from "./modules/settings/settings.repository.ts";
import type { SettingsDeps } from "./modules/settings/settings.service.ts";
import { bootStoreTarget, createStoreFactory } from "./modules/settings/settings.store.ts";
import type { StoreTarget } from "./modules/settings/settings.store.ts";
import type { StorageDeps } from "./modules/storage/storage.service.ts";
import type { EngineWiring } from "./wiring.ts";

/** Settings are built before the jobs runtime; these closures resolve the service at call time. */
export function lazyJobs(get: () => JobsService): SettingsDeps["jobs"] {
  return {
    enqueue: (input) => get().enqueue(input),
    heartbeat: () => get().heartbeat(),
    get: (scope, id) => get().get(scope, id),
  };
}

/**
 * Picks the snapshot store for this boot (environment first, then the stored driver), swaps it
 * behind the live handle, and registers the `storage_migration` job (15 §15.6, §15.7).
 */
export async function bootStore(
  config: Config,
  db: MetadataDb,
  ring: KeyRing,
  wiring: EngineWiring,
  dispatcher: Dispatcher,
  audit: AuditService,
  now: () => Date,
  version: string
): Promise<StoreTarget> {
  const stores = createStoreFactory(config);
  const target = await bootStoreTarget(config, db, ring);
  if (target.driver === "s3") wiring.blobs.swap(stores(target));
  dispatcher.registerKind(
    "storage_migration",
    createStoreMigrationRunner({
      repo: createSettingsRepository(db),
      ring,
      live: wiring.blobs,
      stores,
      referencedBlobs: () => wiring.states.referencedBlobs(),
      audit,
      now,
    })
  );
  dispatcher.registerKind(
    "backup",
    createBackupRunner({
      db,
      dataDir: config.TESTATE_DATA_DIR,
      version,
      ring,
      live: wiring.blobs,
      referencedBlobs: () => wiring.states.referencedBlobs(),
      audit,
      now,
    })
  );
  return target;
}

export function storageDeps(
  wiring: EngineWiring,
  projects: ProjectsRepository,
  audit: AuditService,
  now: () => Date
): StorageDeps {
  return { projects, files: wiring.files, hostKeys: wiring.hostKeys, audit, now };
}
