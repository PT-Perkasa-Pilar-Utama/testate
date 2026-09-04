import type { Config } from "./lib/config/index.ts";
import type { BlobStore } from "./lib/blobstore/index.ts";
import type { MetadataDb } from "./lib/db/index.ts";
import type { KeyRing } from "./lib/sealed/index.ts";
import type { AuditService } from "./modules/audit/audit.service.ts";
import type { Dispatcher, Heartbeat } from "./modules/jobs/jobs.dispatcher.ts";
import type { JobsService } from "./modules/jobs/jobs.service.ts";
import type { HealthDeps } from "./modules/ops/ops.service.ts";
import { createResetHandler } from "./modules/ops/ops.reset.ts";
import type { ResetDeps, ResetDispatcher } from "./modules/ops/ops.reset.ts";
import { createSeeds, devSampleWriter } from "./modules/ops/ops.seeds.ts";
import type { SeedDeps } from "./modules/ops/ops.seeds.ts";
import type { AdaptersRepository } from "./modules/adapters/adapters.repository.ts";
import type { ProjectsRepository } from "./modules/projects/projects.repository.ts";
import type { UsersRepository } from "./modules/users/users.repository.ts";
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

export type SeedServices = Pick<SeedDeps, "users" | "projects" | "adapters" | "states" | "jobs"> & {
  usersRepo: Pick<UsersRepository, "byUsername">;
};

/** The reset endpoint outside production (19 §19.3): wipe, migrate, bootstrap, seed. */
/**
 * The reset route exists only outside production: registration, not authorization, is the gate
 * (07 §7.8). Null here means the path does not exist and answers 404 like any other unknown one.
 */
export function resetHandler(
  config: Config,
  db: MetadataDb,
  migrationsDir: string,
  bootstrap: (() => Promise<boolean>) | null,
  jobs: Pick<JobsService, "heartbeat">,
  resync: () => Promise<void>,
  services: SeedServices,
  dispatcher: ResetDispatcher,
  audit: Pick<AuditService, "record">
): ReturnType<typeof createResetHandler> | null {
  if (config.TESTATE_ENV === "production") return null;
  return createResetHandler(
    resetDeps(config, db, migrationsDir, bootstrap, jobs, services, resync, dispatcher, audit)
  );
}

/** "It refuses while jobs run" (05 §5.15): queued jobs are about to run, not merely on file. */
export function jobsRunningFrom(heartbeat: Heartbeat): boolean {
  return heartbeat.running > 0 || heartbeat.queued > 0;
}

export function resetDeps(
  config: Config,
  db: MetadataDb,
  migrationsDir: string,
  bootstrap: (() => Promise<boolean>) | null,
  jobs: Pick<JobsService, "heartbeat">,
  services: SeedServices,
  resync: () => Promise<void>,
  dispatcher: ResetDispatcher,
  audit: Pick<AuditService, "record">
): ResetDeps {
  return {
    db,
    migrationsDir,
    dataDir: config.TESTATE_DATA_DIR,
    dispatcher,
    defaultSeed: config.TESTATE_RESET_SEED,
    jobsRunning: () => jobsRunningFrom(jobs.heartbeat()),
    bootstrap,
    resync,
    audit,
    trustProxy: config.TESTATE_TRUST_PROXY,
    seed: createSeeds({
      users: services.users,
      projects: services.projects,
      adapters: services.adapters,
      states: services.states,
      jobs: services.jobs,
      admin: () => services.usersRepo.byUsername(config.TESTATE_ADMIN_USER),
      sample: devSampleWriter(),
    }),
  };
}

/** Health and readiness inputs (19 §19.1); the closures read live state at request time. */
export function opsDeps(
  config: Config,
  db: MetadataDb,
  version: string,
  bootId: string,
  bootedAt: number,
  storeTarget: { driver: "local" | "s3" },
  blobs: BlobStore,
  ring: KeyRing,
  logger: { sink: { degraded: boolean } },
  live: { jobs: Pick<JobsService, "heartbeat">; adapters: Pick<AdaptersRepository, "all"> }
): HealthDeps {
  return {
    db,
    dataDir: config.TESTATE_DATA_DIR,
    env: config.TESTATE_ENV,
    version,
    bootId,
    bootedAt,
    storeDriver: storeTarget.driver,
    store: blobs,
    activeKid: ring.activeKid,
    extraKeys: ring.all.size - 1,
    sinkDegraded: () => logger.sink.degraded,
    dispatcher: () => live.jobs.heartbeat(),
  };
}
