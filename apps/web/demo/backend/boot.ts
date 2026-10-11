/**
 * The demo's composition root (#demo): `boot()` from apps/api/src/index.ts, in the page. The
 * same services, handlers, routers and middleware; the disk, the embedded files and the SPA mount
 * are left out, and the engine wiring is the in-browser one. A module added to `createV1` fails
 * this file's type-check rather than going missing from the demo.
 */
import "../../../api/src/lib/http/context.ts";

import { Hono } from "hono";

import {
  createJobsRuntime,
  createRetention,
  migrateOrRefuse,
  sweepSealed,
} from "../../../api/src/boot.ts";
import { apiPrefix, loadConfig } from "../../../api/src/lib/config/index.ts";
import { openMetadataDb } from "../../../api/src/lib/db/index.ts";
import {
  AppError,
  errorResponse,
  hardeningFor,
  installHardening,
  notFound,
} from "../../../api/src/lib/http/index.ts";
import { createLogger } from "../../../api/src/lib/logger/index.ts";
import { createPasswordHasher } from "../../../api/src/lib/password/index.ts";
import { loadKeyRing } from "../../../api/src/lib/sealed/index.ts";
import { createAdaptersHandlers } from "../../../api/src/modules/adapters/adapters.handler.ts";
import { createAuditHandlers } from "../../../api/src/modules/audit/audit.handler.ts";
import { createAuditModule } from "../../../api/src/modules/audit/audit.wiring.ts";
import { createAuthHandlers } from "../../../api/src/modules/auth/auth.handler.ts";
import { createAuthRepository } from "../../../api/src/modules/auth/auth.repository.ts";
import { createAuthService } from "../../../api/src/modules/auth/auth.service.ts";
import { createCheckoutsHandlers } from "../../../api/src/modules/checkouts/checkouts.handler.ts";
import { createDataHandlers } from "../../../api/src/modules/data/data.handler.ts";
import { createDiffsHandlers } from "../../../api/src/modules/diffs/diffs.handler.ts";
import { createImportsHandlers } from "../../../api/src/modules/imports/imports.handler.ts";
import { createV1 } from "../../../api/src/modules/index.ts";
import { createIngestHandlers } from "../../../api/src/modules/ingest/ingest.handler.ts";
import { createJobsHandlers } from "../../../api/src/modules/jobs/jobs.handler.ts";
import { createLogsHandlers } from "../../../api/src/modules/logs/logs.handler.ts";
import { createOpsHandlers } from "../../../api/src/modules/ops/ops.handler.ts";
import { createProjectsHandlers } from "../../../api/src/modules/projects/projects.handler.ts";
import { ensureInspectProject } from "../../../api/src/modules/projects/projects.inspect.ts";
import { createProjectsRepository } from "../../../api/src/modules/projects/projects.repository.ts";
import { createProjectsService } from "../../../api/src/modules/projects/projects.service.ts";
import { createReadingsHandlers } from "../../../api/src/modules/readings/readings.handler.ts";
import { createSettingsHandlers } from "../../../api/src/modules/settings/settings.handler.ts";
import { createSettingsService } from "../../../api/src/modules/settings/settings.service.ts";
import { createStatesHandlers } from "../../../api/src/modules/states/states.handler.ts";
import { createStorageHandlers } from "../../../api/src/modules/storage/storage.handler.ts";
import { createStorageService } from "../../../api/src/modules/storage/storage.service.ts";
import { createToolsHandlers } from "../../../api/src/modules/tools/tools.handler.ts";
import { createToolsService } from "../../../api/src/modules/tools/tools.service.ts";
import { createUsersHandlers } from "../../../api/src/modules/users/users.handler.ts";
import { createUsersRepository } from "../../../api/src/modules/users/users.repository.ts";
import { createUsersService } from "../../../api/src/modules/users/users.service.ts";
import { VERSION } from "../../../api/src/version.ts";
import { agentHandlers } from "../../../api/src/wiring.agent.ts";
import { createStateServices, scopeDeps, settingsDeps } from "../../../api/src/wiring.ts";
import {
  adaptersService,
  bootStore,
  ingestService,
  lazyJobs,
  logsService,
  opsDeps,
  readingsService,
  resetHandler,
  storageDeps,
} from "../../../api/src/wiring.store.ts";
import { demoNetguard, demoWiring } from "./wiring.ts";
import type { DemoWorld } from "./wiring.ts";
import { MIGRATIONS_DIR } from "./migrations.ts";

export const BASE_PATH = "/testate/demo";
export const ADMIN = { username: "admin", password: "demo-admin-1234" } as const;

export type DemoBackend = {
  fetch: (request: Request) => Promise<Response>;
  usersRepo: ReturnType<typeof createUsersRepository>;
  hash: (plain: string) => Promise<string>;
  services: DemoServices;
};

export type DemoServices = {
  users: ReturnType<typeof createUsersService>;
  projects: ReturnType<typeof createProjectsService>;
  adapters: ReturnType<typeof adaptersService>;
  states: ReturnType<typeof createStateServices>["states"];
  checkouts: ReturnType<typeof createStateServices>["checkouts"];
  diffs: ReturnType<typeof createStateServices>["diffs"];
  readings: ReturnType<typeof readingsService>;
  jobs: ReturnType<typeof createJobsRuntime>["jobs"];
};

export async function bootDemo(world: DemoWorld): Promise<DemoBackend> {
  const config = loadConfig({
    TESTATE_ENV: "production",
    TESTATE_DATA_DIR: "/data",
    TESTATE_BASE_PATH: BASE_PATH,
    TESTATE_SECRETS_ACTIVE_KEY: btoa(
      String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))
    ),
    TESTATE_ADMIN_USER: ADMIN.username,
    TESTATE_ADMIN_PASSWORD: ADMIN.password,
    TESTATE_LOG_STDOUT: "false",
  });
  const ring = await loadKeyRing(config.TESTATE_SECRETS_ACTIVE_KEY);
  const logger = createLogger({
    dir: "/data/logs",
    retentionDays: 1,
    stdout: false,
    service: {
      name: "testate-demo",
      version: VERSION,
      boot_id: Bun.randomUUIDv7(),
      base_path: BASE_PATH,
    },
    sampleRate: 0,
    slowMs: 600_000,
    stacks: false,
  });
  const db = openMetadataDb(":memory:");
  migrateOrRefuse(db, MIGRATIONS_DIR, config.TESTATE_DATA_DIR);
  await sweepSealed(ring, db, config);
  const prefix = apiPrefix(config);

  const now = (): Date => new Date();
  const password = createPasswordHasher();
  const { audit, payloads, captureAudit } = createAuditModule(db, now);
  const usersRepo = createUsersRepository(db);
  const authRepo = createAuthRepository(db);
  const projectsRepo = createProjectsRepository(db);
  const auth = createAuthService({
    users: usersRepo,
    repo: authRepo,
    audit,
    password,
    now,
    projectKind: (id) => projectsRepo.byId(id)?.kind ?? null,
    tokenBudget: async () => (await settings.get()).limits.token_requests_per_minute,
  });
  const users = createUsersService({
    repo: usersRepo,
    sessions: { revokeAll: (id) => authRepo.deleteUserSessions(id) },
    audit,
    password,
    now,
    projectExists: (id) => projectsRepo.exists(id),
  });
  await users.bootstrap(ADMIN.username, ADMIN.password);
  ensureInspectProject(projectsRepo, () => usersRepo.firstAdminId(), now);
  const netguard = demoNetguard();
  const wiring = demoWiring(ring, db, netguard, projectsRepo, world);
  const settings = createSettingsService(
    settingsDeps(config, audit, db, now, {
      setDeny: () => undefined,
      recheck: () => adapters.recheckDenyList(),
      removeState: (id) => core.states.removeNow(id),
      pruneAuditPayloads: payloads.prune,
      jobs: lazyJobs(() => jobs),
      ring,
      netguard,
    })
  );
  const { jobs, dispatcher } = createJobsRuntime(db, logger, audit, config, now, {
    ...wiring,
    quota: async () => (await settings.get()).quota,
  });
  const storeTarget = await bootStore(config, db, ring, wiring, dispatcher, audit, now, VERSION);
  const core = createStateServices(wiring, projectsRepo, jobs, audit, settings, config, now, {
    createAdapter: async (actor, project, draft, meta) =>
      (await adapters.create(actor, project.slug, draft, meta)).adapter,
  });
  const storage = createStorageService(storageDeps(wiring, projectsRepo, audit, now));
  const logs = logsService(wiring, projectsRepo);
  const readings = readingsService(db, wiring, projectsRepo, now);
  const shared = { projects: projectsRepo, audit, now };
  const ingest = ingestService(db, wiring, { ...shared, settings });
  const adapters = adaptersService(db, wiring, { ...shared, ring, netguard, jobs, ingest });
  const projects = createProjectsService({
    repo: projectsRepo,
    audit,
    settings,
    adapters,
    jobs,
    now,
  });
  const live = { jobs, adapters: wiring.adapters };
  const seedServices = { users, projects, adapters, states: core.states, jobs, usersRepo };

  const handlers = {
    ops: createOpsHandlers(
      opsDeps(
        config,
        db,
        VERSION,
        "demo",
        Date.now(),
        storeTarget,
        wiring.blobs,
        ring,
        logger,
        live
      ),
      () => true
    ),
    resetState: resetHandler(
      config,
      db,
      MIGRATIONS_DIR,
      null,
      jobs,
      async () => undefined,
      seedServices,
      dispatcher,
      audit
    ),
    auth: createAuthHandlers(auth, {
      env: config.TESTATE_ENV,
      basePath: BASE_PATH,
      secureCookies: false,
      trustProxy: false,
      now,
      settings,
    }),
    users: createUsersHandlers(users, false),
    projects: createProjectsHandlers(projects, prefix, false, jobs),
    ...scopeDeps(projectsRepo, wiring.adapters),
    adapters: createAdaptersHandlers(adapters, prefix, false, jobs),
    data: createDataHandlers(core.data, false),
    imports: createImportsHandlers(core.imports, prefix, false),
    states: createStatesHandlers(core.states, prefix, false, jobs),
    checkouts: createCheckoutsHandlers(core.checkouts, prefix, false, jobs),
    diffs: createDiffsHandlers(core.diffs, prefix, false, jobs),
    storage: createStorageHandlers(storage, false, config.TESTATE_MAX_UPLOAD_MB * 1024 * 1024),
    logs: createLogsHandlers(logs),
    ingest: createIngestHandlers(ingest, false, now),
    readings: createReadingsHandlers(readings),
    jobs: createJobsHandlers(jobs),
    audit: createAuditHandlers(audit),
    settings: createSettingsHandlers(settings, prefix, false),
    tools: createToolsHandlers(createToolsService()),
    agent: agentHandlers(
      {
        projects,
        projectsRepo,
        adapters,
        adaptersRepo: wiring.adapters,
        storage,
        logs,
        jobs,
        audit,
        ...core,
      },
      { settings, trustProxy: false, now }
    ),
  };

  const app = new Hono();
  app.use("*", logger.middleware());
  installHardening(app, hardeningFor(config, prefix, auth, now));
  app.use("*", captureAudit);
  app.onError((cause, c) => {
    // The demo has no log files: an unexpected error is reported to the browser instead.
    if (!(cause instanceof AppError)) reportError(cause);
    return errorResponse(c, cause, c.get("event"), false);
  });
  app.notFound((c) => errorResponse(c, notFound("route"), c.get("event"), false));
  app.route(prefix, createV1(handlers));

  dispatcher.start();
  createRetention(logger, {
    sweepJobs: () => jobs.sweep,
    historyDays: async () => (await settings.get()).retention.job_history_days,
    expireDiffs: () => core.diffs.expire(),
    settings: () => settings.runRetention(),
    ingest: () => ingest.sweep(),
    readings: (days) => readings.sweep(days),
  });

  return {
    fetch: async (request) => app.fetch(request),
    usersRepo,
    hash: (plain) => password.hash(plain),
    services: {
      users,
      projects,
      adapters,
      states: core.states,
      checkouts: core.checkouts,
      diffs: core.diffs,
      readings,
      jobs,
    },
  };
}
