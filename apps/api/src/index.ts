/**
 * Testate API composition root.
 *
 * AI AGENTS: boot order is fixed by docs/technical-specs/22-base-path-and-boot.md.
 * Wire modules here; put no business logic in this file.
 */
import "./lib/http/context.ts";

import { join } from "node:path";
import { Scalar } from "@scalar/hono-api-reference";
import { Hono } from "hono";

import {
  bootstrapAdmin,
  createJobsRuntime,
  createNetguard,
  createRetention,
  preMigrationCopy,
  ensureDirs,
  migrateOrRefuse,
  refuse,
  resetAdminPassword,
  serve,
  sweepSealed,
} from "./boot.ts";
import { createEngineWiring, createStateServices, settingsDeps } from "./wiring.ts";
import { bootStore, lazyJobs, opsDeps, resetHandler, storageDeps } from "./wiring.store.ts";
import { apiPrefix, loadConfig, logDir } from "./lib/config/index.ts";
import { openMetadataDb } from "./lib/db/index.ts";
import { authenticate } from "./lib/http/auth.ts";
import { errorResponse, notFound } from "./lib/http/index.ts";
import { createLogger } from "./lib/logger/index.ts";
import { mountOpenApi } from "./lib/openapi.ts";
import { createPasswordHasher } from "./lib/password/index.ts";
import { loadKeyRing } from "./lib/sealed/index.ts";
import { createAdaptersHandlers } from "./modules/adapters/adapters.handler.ts";
import { createAdaptersService } from "./modules/adapters/adapters.service.ts";
import { createAgentHandlers } from "./modules/agent/agent.handler.ts";
import { createAgentService } from "./modules/agent/agent.service.ts";
import { createAgentTools } from "./modules/agent/agent.tools.ts";
import { createAuditHandlers } from "./modules/audit/audit.handler.ts";
import { createAuditRepository } from "./modules/audit/audit.repository.ts";
import { createAuditService } from "./modules/audit/audit.service.ts";
import { createAuthHandlers } from "./modules/auth/auth.handler.ts";
import { createAuthRepository } from "./modules/auth/auth.repository.ts";
import { createAuthService } from "./modules/auth/auth.service.ts";
import { createCheckoutsHandlers } from "./modules/checkouts/checkouts.handler.ts";
import { createDataHandlers } from "./modules/data/data.handler.ts";
import { createDiffsHandlers } from "./modules/diffs/diffs.handler.ts";
import { createImportsHandlers } from "./modules/imports/imports.handler.ts";
import { createV1 } from "./modules/index.ts";
import { createJobsHandlers } from "./modules/jobs/jobs.handler.ts";
import { mountSpa, resolveWebSource, rewriteWebAssets } from "./modules/ops/ops.basepath.ts";
import { createOpsHandlers } from "./modules/ops/ops.handler.ts";
import { createProjectsHandlers } from "./modules/projects/projects.handler.ts";
import { createProjectsRepository } from "./modules/projects/projects.repository.ts";
import { requireProjectInScope } from "./modules/projects/projects.scope.ts";
import { createProjectsService } from "./modules/projects/projects.service.ts";
import { createSettingsHandlers } from "./modules/settings/settings.handler.ts";
import { createSettingsService } from "./modules/settings/settings.service.ts";
import { createStatesHandlers } from "./modules/states/states.handler.ts";
import { createStorageHandlers } from "./modules/storage/storage.handler.ts";
import { createStorageService } from "./modules/storage/storage.service.ts";
import { createToolsHandlers } from "./modules/tools/tools.handler.ts";
import { createToolsService } from "./modules/tools/tools.service.ts";
import { createUsersHandlers } from "./modules/users/users.handler.ts";
import { createUsersRepository } from "./modules/users/users.repository.ts";
import { createUsersService } from "./modules/users/users.service.ts";
import { VERSION } from "./version.ts";

export type App = {
  fetch: Hono["fetch"];
  port: number;
  /** Step 10 of 22 §22.2: dispatcher and retention timer start once the listener is up. */
  start: () => void;
  /** 22 §22.4: drain running jobs (30 s), then close the sink and the database. */
  close: () => Promise<void>;
};

/** Runs the boot sequence and returns the Hono app. Throws a named error on any refusal. */
export async function boot(env: Readonly<Record<string, string | undefined>>): Promise<App> {
  const config = loadConfig(env);
  const bootId = Bun.randomUUIDv7();
  const bootedAt = Date.now();
  const ring = await loadKeyRing(config.TESTATE_SECRETS_ACTIVE_KEY);
  ensureDirs(config);
  const logger = createLogger({
    dir: logDir(config),
    retentionDays: config.TESTATE_LOG_RETENTION_DAYS,
    stdout: config.TESTATE_LOG_STDOUT,
    service: {
      name: "testate",
      version: VERSION,
      boot_id: bootId,
      base_path: config.TESTATE_BASE_PATH,
    },
    sampleRate: config.TESTATE_LOG_SAMPLE_RATE,
    slowMs: config.TESTATE_LOG_SLOW_MS,
    stacks: config.TESTATE_LOG_STACKS,
  });
  const rollbackCopy = preMigrationCopy(config.TESTATE_DATA_DIR, bootId);
  const db = openMetadataDb(join(config.TESTATE_DATA_DIR, "metadata.db"));
  // Migrations live next to this entry in both layouts: src/db/migrations and dist/db/migrations.
  const migrationsDir = join(import.meta.dir, "db", "migrations");
  const migration = migrateOrRefuse(db, migrationsDir, config.TESTATE_DATA_DIR);
  const sealed = await sweepSealed(ring, db, config);
  const prefix = apiPrefix(config);
  const webSource = resolveWebSource(import.meta.dir);
  const web =
    webSource === null
      ? null
      : rewriteWebAssets(
          webSource,
          join(config.TESTATE_DATA_DIR, "run", "web"),
          config.TESTATE_BASE_PATH
        );

  const now = (): Date => new Date();
  const password = createPasswordHasher();
  const audit = createAuditService({ repo: createAuditRepository(db), now });
  const usersRepo = createUsersRepository(db);
  const authRepo = createAuthRepository(db);
  const projectsRepo = createProjectsRepository(db);
  const auth = createAuthService({
    users: usersRepo,
    repo: authRepo,
    audit,
    password,
    now,
    projectExists: (id) => projectsRepo.exists(id),
    tokenBudget: async () => (await settings.get()).limits.token_requests_per_minute,
  });
  const users = createUsersService({
    repo: usersRepo,
    sessions: { revokeAll: (id) => authRepo.deleteUserSessions(id) },
    audit,
    password,
    now,
  });
  const { bootstrapped, bootstrap } = await bootstrapAdmin(usersRepo.count(), users, config);
  const adminReset = await resetAdminPassword(users, config);
  const netguard = createNetguard(config);
  const wiring = createEngineWiring(config, ring, db, netguard, projectsRepo);
  const settings = createSettingsService(
    settingsDeps(config, audit, db, now, {
      setDeny: (deny) => netguard.setDeny(deny),
      recheck: () => adapters.recheckDenyList(),
      removeState: (id) => core.states.removeNow(id),
      jobs: lazyJobs(() => jobs),
      ring,
      netguard,
    })
  );
  netguard.setDeny((await settings.get()).netguard.deny);
  const { jobs, dispatcher } = createJobsRuntime(db, logger, audit, config, now, {
    ...wiring,
    quota: async () => (await settings.get()).quota,
  });
  const storeTarget = await bootStore(config, db, ring, wiring, dispatcher, audit, now, VERSION);
  // Steps 8 and 9 of 22 §22.2: recover interrupted jobs, then sweep old ones.
  const recovery = await jobs.recover();
  const core = createStateServices(wiring, projectsRepo, jobs, audit, settings, config, now, {
    createAdapter: async (actor, project, draft, meta) =>
      (await adapters.create(actor, project.slug, draft, meta)).adapter,
  });
  const storage = createStorageService(storageDeps(wiring, projectsRepo, audit, now));
  const adapters = createAdaptersService({
    repo: wiring.adapters,
    projects: projectsRepo,
    audit,
    ring,
    netguard,
    probe: wiring.probe,
    fileProbe: wiring.fileProbe,
    jobs,
    now,
  });
  const projects = createProjectsService({
    repo: projectsRepo,
    audit,
    settings,
    adapters,
    jobs,
    now,
  });
  let ready = false;
  const live = { jobs, adapters: wiring.adapters };
  const resyncPolicy = async (): Promise<void> =>
    netguard.setDeny((await settings.get()).netguard.deny);

  const handlers = {
    ops: createOpsHandlers(
      opsDeps(config, db, VERSION, bootId, bootedAt, storeTarget, wiring.blobs, ring, logger, live),
      () => ready
    ),
    resetState: resetHandler(config, db, migrationsDir, bootstrap, jobs, resyncPolicy, {
      users,
      projects,
      adapters,
      states: core.states,
      jobs,
      usersRepo,
    }),
    auth: createAuthHandlers(auth, {
      env: config.TESTATE_ENV,
      basePath: config.TESTATE_BASE_PATH,
      secureCookies: config.TESTATE_TRUST_PROXY,
      trustProxy: config.TESTATE_TRUST_PROXY,
      now,
      settings,
    }),
    users: createUsersHandlers(users, config.TESTATE_TRUST_PROXY),
    projects: createProjectsHandlers(projects, prefix, config.TESTATE_TRUST_PROXY, jobs),
    projectScope: requireProjectInScope(projectsRepo),
    adapters: createAdaptersHandlers(adapters, prefix, config.TESTATE_TRUST_PROXY, jobs),
    data: createDataHandlers(core.data, config.TESTATE_TRUST_PROXY),
    imports: createImportsHandlers(core.imports, prefix, config.TESTATE_TRUST_PROXY),
    states: createStatesHandlers(core.states, prefix, config.TESTATE_TRUST_PROXY),
    checkouts: createCheckoutsHandlers(core.checkouts, prefix, config.TESTATE_TRUST_PROXY, jobs),
    diffs: createDiffsHandlers(core.diffs, prefix, config.TESTATE_TRUST_PROXY),
    storage: createStorageHandlers(storage, config.TESTATE_TRUST_PROXY),
    jobs: createJobsHandlers(jobs),
    audit: createAuditHandlers(audit),
    settings: createSettingsHandlers(settings, prefix, config.TESTATE_TRUST_PROXY),
    tools: createToolsHandlers(createToolsService()),
    agent: createAgentHandlers(
      createAgentService(VERSION),
      createAgentTools({
        projects,
        projectsRepo,
        adapters,
        adaptersRepo: wiring.adapters,
        storage,
        audit,
        ...core,
      }),
      { settings, trustProxy: config.TESTATE_TRUST_PROXY, now }
    ),
  };

  const app = new Hono();
  app.use("*", logger.middleware());
  app.use("*", authenticate(auth));
  app.onError((cause, c) => errorResponse(c, cause, c.get("event"), config.TESTATE_LOG_STACKS));
  app.notFound((c) => errorResponse(c, notFound("route"), c.get("event"), false));

  const v1 = createV1(handlers);
  mountOpenApi(v1, VERSION);
  v1.get("/docs", Scalar({ url: `${prefix}/openapi.json` }));
  app.route(prefix, v1);
  if (web !== null) mountSpa(app, config.TESTATE_BASE_PATH, prefix, web.dir);

  const bootEvent = logger.create("boot");
  bootEvent.add("op", {
    name: "boot",
    migrations_applied: migration.applied,
    migrations_skipped: migration.skipped,
    pre_migration_copy: rollbackCopy !== null,
    reset_state_mounted: config.TESTATE_ENV !== "production",
    bootstrap_admin_created: bootstrapped,
    admin_password_reset: adminReset,
    jobs_interrupted: recovery.interrupted,
    jobs_head_unknown: recovery.head_unknown,
    sealed_re_sealed: sealed.reSealed,
    sealed_unreadable: sealed.unreadable.length,
    sealed_banner: sealed.banner,
    web_files: web?.files ?? 0,
    web_rewritten: web?.rewritten ?? 0,
  });
  bootEvent.emit();
  ready = true;

  const retention = createRetention(
    logger,
    () => jobs.sweep,
    async () => (await settings.get()).retention.job_history_days,
    () => core.diffs.expire()
  );
  return {
    fetch: app.fetch,
    port: config.PORT,
    start: () => {
      dispatcher.start();
      retention.start();
    },
    close: async () => {
      retention.stop();
      const survivors = await dispatcher.drain(30_000);
      const event = logger.create("shutdown");
      event.add("op", { name: "shutdown", jobs_interrupted: survivors.length });
      event.emit();
      logger.sink.close();
      db.close();
    },
  };
}

async function bootOrRefuse(): Promise<App> {
  try {
    return await boot(Bun.env);
  } catch (cause: unknown) {
    return refuse(cause);
  }
}

if (import.meta.main) serve(await bootOrRefuse());
