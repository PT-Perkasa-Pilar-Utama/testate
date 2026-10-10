/** Composition helpers: repositories, engines, and the services built on them (22 §22.2). */
import type { MiddlewareHandler } from "hono";
import { join } from "node:path";
import type { Settings } from "@testate/shared";
import { idSchema } from "@testate/shared";
import * as v from "valibot";
import type { V1Deps } from "./modules/index.ts";
import { requireProjectInScope } from "./modules/projects/projects.scope.ts";

import { currentActor } from "./lib/http/auth.ts";
import { notFound, param } from "./lib/http/index.ts";
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
import type { AdaptersRepository } from "./modules/adapters/adapters.repository.ts";
import { assertAdapterInProject } from "./modules/adapters/adapters.scope.ts";
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
import { createSettingsRepository } from "./modules/settings/settings.repository.ts";
import type { SettingsDeps } from "./modules/settings/settings.service.ts";
import { createStatesRepository } from "./modules/states/states.repository.ts";
import { createStatesService } from "./modules/states/states.service.ts";
import type { StatesDeps, StatesService } from "./modules/states/states.service.ts";
import type { JobsService } from "./modules/jobs/jobs.service.ts";
import { createIngestStore } from "./lib/logs/ingest/store.ts";
import { openDocker } from "./lib/logs/docker/connect.ts";
import { createEsApi } from "./lib/logs/elasticsearch/api.ts";
import { createLokiApi } from "./lib/logs/loki/api.ts";
import { createSshShell } from "./lib/logs/journald/shell.ts";
import { createShellResolver } from "./modules/adapters/adapters.shell.ts";
import { createDockerResolver } from "./modules/adapters/adapters.docker.api.ts";
import type { DockerResolver } from "./modules/adapters/adapters.docker.api.ts";
import { createLokiResolver } from "./modules/adapters/adapters.loki.api.ts";
import type { LokiResolver } from "./modules/adapters/adapters.loki.api.ts";
import { createEsResolver } from "./modules/adapters/adapters.elasticsearch.api.ts";
import type { EsResolver } from "./modules/adapters/adapters.elasticsearch.api.ts";
import type { ShellResolver } from "./modules/adapters/adapters.shell.ts";
import type { IngestStore } from "./lib/logs/ingest/store.ts";

export type EngineWiring = Omit<RunnerDeps, "db" | "audit" | "now" | "blobs"> & {
  netguard: Netguard;
  blobs: SwitchableBlobStore;
  data: DataRepository;
  policies: PoliciesRepository;
  diffs: DiffsRepository;
  imports: ImportsRepository;
  dataDir: string;
  probe: ProbeFn;
  fileProbe: FileProbeFn;
  hostKeys: HostKeysRepository;
  files: FilesResolver;
  ingest: IngestStore;
  /** A journald adapter's checked SSH command channel (#86). */
  shells: ShellResolver;
  /** A docker adapter's checked Engine API connection (#88). */
  dockers: DockerResolver;
  /** A loki adapter's checked client (#90). */
  lokis: LokiResolver;
  /** An elasticsearch adapter's checked client (#92). */
  searches: EsResolver;
};

/** One authenticated, kind-agnostic adapter ownership check for all v1 adapter routes. */
export function createAdapterScope(
  projects: Pick<ProjectsRepository, "bySlug">,
  adapters: Pick<AdaptersRepository, "byId">
): MiddlewareHandler {
  const projectOf = (slug: string) => {
    const project = projects.bySlug(slug);
    if (project === null) throw notFound("project");
    return project;
  };
  const assertInProject = assertAdapterInProject(projectOf, adapters.byId);
  return async (c, next) => {
    currentActor(c);
    // `/projects/:slug/adapters/:id/*` also matches `POST /projects/:slug/adapters/test`, the
    // connection test for a draft that has no adapter yet: Hono's `/*` matches an empty rest. Only
    // an id names an adapter to own; any other segment is a route of its own, and it 404s itself
    // when nothing answers it.
    const id = param(c, "id");
    if (v.is(idSchema, id)) assertInProject(param(c, "slug"), id);
    await next();
  };
}

/** Project token scope and adapter ownership are wired together at the v1 boundary. */
export function scopeDeps(
  projects: Pick<ProjectsRepository, "bySlug">,
  adapters: Pick<AdaptersRepository, "byId">
): Pick<V1Deps, "projectScope" | "adapterScope"> {
  return {
    projectScope: requireProjectInScope(projects),
    adapterScope: createAdapterScope(projects, adapters),
  };
}

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
    netguard,
    engines,
    adapterLanes: config.TESTATE_JOB_CONCURRENCY,
    probe: createEngineProbe(engines, createScaffoldProbe()),
    fileProbe: createFileProbe(
      openFileSource,
      createScaffoldFileProbe(),
      createSshShell,
      openDocker,
      createLokiApi,
      createEsApi
    ),
    hostKeys,
    files: createFilesResolver({
      repo: adapters,
      hostKeys,
      ring,
      netguard,
      open: openFileSource,
      now,
    }),
    shells: createShellResolver({
      repo: adapters,
      hostKeys,
      ring,
      netguard,
      openShell: createSshShell,
      now,
    }),
    dockers: createDockerResolver({ repo: adapters, hostKeys, ring, netguard, openDocker, now }),
    lokis: createLokiResolver({
      repo: adapters,
      hostKeys,
      ring,
      netguard,
      openLoki: createLokiApi,
      now,
    }),
    searches: createEsResolver({
      repo: adapters,
      hostKeys,
      ring,
      netguard,
      openEs: createEsApi,
      now,
    }),
    blobs: createSwitchableBlobStore(createLocalBlobStore(join(config.TESTATE_DATA_DIR, "blobs"))),
    ring,
    adapters,
    states: createStatesRepository(db),
    checkouts: createCheckoutsRepository(db),
    data: createDataRepository(db),
    policies: createPoliciesRepository(db),
    diffs: createDiffsRepository(db),
    imports: createImportsRepository(db),
    dataDir: config.TESTATE_DATA_DIR,
    ingest: createIngestStore(join(config.TESTATE_DATA_DIR, "logs-ingest"), now),
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
  pruneAuditPayloads: (before: string) => number;
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
    retention: {
      db,
      removeState: hooks.removeState,
      pruneAuditPayloads: hooks.pruneAuditPayloads,
      dataDir: config.TESTATE_DATA_DIR,
    },
    now,
  };
}
