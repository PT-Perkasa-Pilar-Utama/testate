/** Composition helpers: repositories, engines, and the services built on them (22 §22.2). */
import { join } from "node:path";
import type { Settings } from "@testate/shared";
import type { Config } from "./lib/config/index.ts";
import type { MetadataDb } from "./lib/db/index.ts";
import type { KeyRing } from "./lib/sealed/index.ts";
import type { AuditService } from "./modules/audit/audit.service.ts";
import type { RunnerDeps } from "./modules/jobs/jobs.runners.ts";
import { createLocalBlobStore, createSwitchableBlobStore } from "./lib/blobstore/index.ts";
import type { SwitchableBlobStore } from "./lib/blobstore/index.ts";
import { createEngineRegistry } from "./lib/engines/index.ts";
import type { Netguard } from "./lib/engines/index.ts";
import {
  createEngineProbe,
  createHttpProbe,
  createScaffoldFileProbe,
  createScaffoldProbe,
} from "./modules/adapters/adapters.probe.ts";
import { createFileProbe, createFilesResolver } from "./modules/adapters/adapters.files.ts";
import type { FilesResolver } from "./modules/adapters/adapters.files.ts";
import { createHostKeysRepository } from "./modules/adapters/adapters.hostkeys.ts";
import type { HostKeysRepository } from "./modules/adapters/adapters.hostkeys.ts";
import type { FileProbeFn, ProbeFn } from "./modules/adapters/adapters.probe.ts";
import { openFileSource } from "./lib/files/open.ts";
import { createAdaptersRepository } from "./modules/adapters/adapters.repository.ts";
import type { ProjectsRepository } from "./modules/projects/projects.repository.ts";
import { createCheckoutsRepository } from "./modules/checkouts/checkouts.repository.ts";
import { createCheckoutsService } from "./modules/checkouts/checkouts.service.ts";
import type { CheckoutsDeps, CheckoutsService } from "./modules/checkouts/checkouts.service.ts";
import { createPoliciesRepository } from "./modules/data/data.policies.ts";
import type { PoliciesRepository } from "./modules/data/data.policies.ts";
import { createDataRepository } from "./modules/data/data.repository.ts";
import type { DataRepository } from "./modules/data/data.repository.ts";
import { createDataService } from "./modules/data/data.service.ts";
import type { DataService } from "./modules/data/data.service.ts";
import { createDiffsRepository } from "./modules/diffs/diffs.repository.ts";
import type { DiffsRepository } from "./modules/diffs/diffs.repository.ts";
import { createDiffsService } from "./modules/diffs/diffs.service.ts";
import type { DiffsService } from "./modules/diffs/diffs.service.ts";
import { createImportsRepository } from "./modules/imports/imports.repository.ts";
import type { ImportsRepository } from "./modules/imports/imports.repository.ts";
import { createImportsService } from "./modules/imports/imports.service.ts";
import type { ImportsService } from "./modules/imports/imports.service.ts";
import { createHooksRepository } from "./modules/hooks/hooks.repository.ts";
import type { HooksRepository } from "./modules/hooks/hooks.repository.ts";
import { createHooksService } from "./modules/hooks/hooks.service.ts";
import type { HooksDeps, HooksService } from "./modules/hooks/hooks.service.ts";
import { createRestRepository } from "./modules/rest/rest.repository.ts";
import type { RestRepository } from "./modules/rest/rest.repository.ts";
import { createRestService } from "./modules/rest/rest.service.ts";
import type { RestDeps, RestService } from "./modules/rest/rest.service.ts";
import { createSettingsRepository } from "./modules/settings/settings.repository.ts";
import type { SettingsDeps } from "./modules/settings/settings.service.ts";
import { createStatesRepository } from "./modules/states/states.repository.ts";
import { createStatesService } from "./modules/states/states.service.ts";
import type { StatesDeps, StatesService } from "./modules/states/states.service.ts";
import type { JobsService } from "./modules/jobs/jobs.service.ts";

export type EngineWiring = Omit<RunnerDeps, "db" | "audit" | "now" | "hooks" | "blobs"> & {
  blobs: SwitchableBlobStore;
  requests: RestRepository;
  hooks: HooksRepository;
  data: DataRepository;
  policies: PoliciesRepository;
  diffs: DiffsRepository;
  imports: ImportsRepository;
  dataDir: string;
  probe: ProbeFn;
  fileProbe: FileProbeFn;
  hostKeys: HostKeysRepository;
  files: FilesResolver;
};

/** The engine registry, blob store, and repositories the job runners share with the services (12 §12.9, 15 §15.2). */
export function createEngineWiring(
  config: Config,
  ring: KeyRing,
  db: MetadataDb,
  netguard: Netguard,
  projects: ProjectsRepository
): EngineWiring {
  const engines = createEngineRegistry(netguard);
  const adapters = createAdaptersRepository(db);
  const hostKeys = createHostKeysRepository(db);
  const now = (): Date => new Date();
  return {
    engines,
    adapterLanes: config.TESTATE_JOB_CONCURRENCY,
    probe: createEngineProbe(engines, createScaffoldProbe()),
    fileProbe: createFileProbe(openFileSource, createHttpProbe(createScaffoldFileProbe())),
    hostKeys,
    files: createFilesResolver({
      repo: adapters,
      hostKeys,
      ring,
      netguard,
      open: openFileSource,
      now,
    }),
    blobs: createSwitchableBlobStore(createLocalBlobStore(join(config.TESTATE_DATA_DIR, "blobs"))),
    ring,
    adapters,
    states: createStatesRepository(db),
    checkouts: createCheckoutsRepository(db),
    requests: createRestRepository(db),
    hooks: createHooksRepository(db),
    data: createDataRepository(db),
    policies: createPoliciesRepository(db),
    diffs: createDiffsRepository(db),
    imports: createImportsRepository(db),
    dataDir: config.TESTATE_DATA_DIR,
    projects,
  };
}

/** The states service sits on the shared wiring plus the jobs and audit services (05 §5.8). */
export function statesDeps(
  wiring: EngineWiring,
  projects: ProjectsRepository,
  jobs: JobsService,
  audit: AuditService,
  now: () => Date
): StatesDeps {
  return {
    repo: wiring.states,
    projects,
    adapters: wiring.adapters,
    jobs,
    blobs: wiring.blobs,
    audit,
    now,
    uploads: wiring.imports,
  };
}

export function checkoutsDeps(
  wiring: EngineWiring,
  projects: ProjectsRepository,
  jobs: JobsService,
  audit: AuditService,
  now: () => Date
): CheckoutsDeps {
  return { ...wiring, repo: wiring.checkouts, projects, jobs, audit, now };
}

export function restDeps(
  wiring: EngineWiring,
  projects: ProjectsRepository,
  netguard: Netguard,
  now: () => Date
): RestDeps {
  return {
    repo: wiring.requests,
    adapters: wiring.adapters,
    projects,
    ring: wiring.ring,
    netguard,
    now,
  };
}

export function hooksDeps(
  wiring: EngineWiring,
  rest: RestService,
  projects: ProjectsRepository,
  audit: AuditService,
  now: () => Date
): HooksDeps {
  return {
    repo: wiring.hooks,
    rest,
    requests: wiring.requests,
    adapters: wiring.adapters,
    projects,
    audit,
    now,
  };
}

export type Integrations = { rest: RestService; hooks: HooksService };

/** REST requests and hooks exist before the jobs runtime, which runs hooks (05 §5.12-5.13). */
export function createIntegrations(
  wiring: EngineWiring,
  projects: ProjectsRepository,
  netguard: Netguard,
  audit: AuditService,
  now: () => Date
): Integrations {
  const rest = createRestService(restDeps(wiring, projects, netguard, now));
  const hooks = createHooksService(hooksDeps(wiring, rest, projects, audit, now));
  return { rest, hooks };
}

export type StateServices = {
  states: StatesService;
  checkouts: CheckoutsService;
  data: DataService;
  diffs: DiffsService;
  imports: ImportsService;
};

export function createStateServices(
  wiring: EngineWiring,
  projects: ProjectsRepository,
  jobs: JobsService,
  audit: AuditService,
  settings: { get(): Promise<Settings> },
  config: Config,
  now: () => Date,
  extra: Pick<StatesDeps, "createAdapter">
): StateServices {
  const maxUploadBytes = config.TESTATE_MAX_UPLOAD_MB * 1024 * 1024;
  return {
    states: createStatesService({ ...statesDeps(wiring, projects, jobs, audit, now), ...extra }),
    checkouts: createCheckoutsService(checkoutsDeps(wiring, projects, jobs, audit, now)),
    data: createDataService({ ...wiring, repo: wiring.data, projects, jobs, settings, audit, now }),
    diffs: createDiffsService({
      ...wiring,
      repo: wiring.diffs,
      projects,
      jobs,
      settings,
      audit,
      now,
    }),
    imports: createImportsService({
      ...wiring,
      repo: wiring.imports,
      projects,
      jobs,
      audit,
      maxUploadBytes,
      now,
    }),
  };
}

export type SettingsHooks = {
  setDeny: (deny: string[]) => void;
  recheck: () => Promise<string[]>;
  removeState: (id: string) => Promise<void>;
  jobs: SettingsDeps["jobs"];
  ring: KeyRing;
  netguard: Netguard;
};

/** Settings need the live netguard, the adapters service, and the states service; all arrive as closures. */
export function settingsDeps(
  config: Config,
  audit: AuditService,
  db: MetadataDb,
  now: () => Date,
  hooks: SettingsHooks
): SettingsDeps {
  return {
    repo: createSettingsRepository(db),
    config,
    audit,
    ring: hooks.ring,
    netguard: hooks.netguard,
    jobs: hooks.jobs,
    recheckDenyList: async (deny) => {
      hooks.setDeny(deny);
      return hooks.recheck();
    },
    retention: { db, removeState: hooks.removeState, dataDir: config.TESTATE_DATA_DIR },
    now,
  };
}
