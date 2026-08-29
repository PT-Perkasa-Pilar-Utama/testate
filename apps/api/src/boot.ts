/**
 * Boot helpers the composition root calls in order (22 §22.2). Wiring only; each step's rule
 * lives in the library or module it calls.
 */
import { networkInterfaces } from "node:os";
import { join } from "node:path";

import type { Settings } from "@testate/shared";

import { ConfigError } from "./lib/config/index.ts";
import type { Config } from "./lib/config/index.ts";
import type { MetadataDb } from "./lib/db/index.ts";
import { SealedConfigError } from "./lib/sealed/index.ts";
import type { KeyRing } from "./lib/sealed/index.ts";
import { banner, disableUnreadableOwners, sweep } from "./lib/sealed/registry.ts";
import type { Unreadable } from "./lib/sealed/registry.ts";
import type { Logger } from "./lib/logger/index.ts";
import type { AuditService } from "./modules/audit/audit.service.ts";
import { createDispatcher } from "./modules/jobs/jobs.dispatcher.ts";
import type { Dispatcher } from "./modules/jobs/jobs.dispatcher.ts";
import { createJobEventHub } from "./modules/jobs/jobs.events.ts";
import { createJobsRepository } from "./modules/jobs/jobs.repository.ts";
import { registerRunners } from "./modules/jobs/jobs.runners.ts";
import type { RunnerDeps } from "./modules/jobs/jobs.runners.ts";
import { createLocalBlobStore } from "./lib/blobstore/index.ts";
import { createEngineRegistry } from "./lib/engines/index.ts";
import { check as netguardCheck, parseDenyList } from "./lib/netguard/index.ts";
import type { Netguard } from "./lib/engines/index.ts";
import {
  createEngineProbe,
  createHttpProbe,
  createScaffoldFileProbe,
  createScaffoldProbe,
} from "./modules/adapters/adapters.probe.ts";
import type { FileProbeFn, ProbeFn } from "./modules/adapters/adapters.probe.ts";
import { createAdaptersRepository } from "./modules/adapters/adapters.repository.ts";
import type { ProjectsRepository } from "./modules/projects/projects.repository.ts";
import { createCheckoutsRepository } from "./modules/checkouts/checkouts.repository.ts";
import { createCheckoutsService } from "./modules/checkouts/checkouts.service.ts";
import type { CheckoutsDeps, CheckoutsService } from "./modules/checkouts/checkouts.service.ts";
import { createDataRepository } from "./modules/data/data.repository.ts";
import type { DataRepository } from "./modules/data/data.repository.ts";
import { createDataService } from "./modules/data/data.service.ts";
import type { DataService } from "./modules/data/data.service.ts";
import { createHooksRepository } from "./modules/hooks/hooks.repository.ts";
import type { HooksRepository } from "./modules/hooks/hooks.repository.ts";
import { createHooksService } from "./modules/hooks/hooks.service.ts";
import type { HooksDeps, HooksService } from "./modules/hooks/hooks.service.ts";
import { createRestRepository } from "./modules/rest/rest.repository.ts";
import type { RestRepository } from "./modules/rest/rest.repository.ts";
import { createRestService } from "./modules/rest/rest.service.ts";
import type { RestDeps, RestService } from "./modules/rest/rest.service.ts";
import { createStatesRepository } from "./modules/states/states.repository.ts";
import { createStatesService } from "./modules/states/states.service.ts";
import type { StatesDeps, StatesService } from "./modules/states/states.service.ts";
import { createJobsService } from "./modules/jobs/jobs.service.ts";
import type { JobsService } from "./modules/jobs/jobs.service.ts";
import type { UsersService } from "./modules/users/users.service.ts";

const RULE = "=".repeat(72);

export type SealedBoot = { reSealed: number; unreadable: Unreadable[]; banner: string | null };

export type Bootstrap = { bootstrapped: boolean; bootstrap: (() => Promise<boolean>) | null };

/** Every address this process listens on, so an adapter cannot point Testate at itself (18 §18.1). */
/** The outbound address policy every engine connect passes through (18 §18.2). */
export function createNetguard(config: Config, deny: readonly string[]): Netguard {
  const denyList = parseDenyList(deny);
  const self = { addresses: ownAddresses(), port: config.PORT };
  return { check: (input) => netguardCheck(input, denyList, self) };
}

export function ownAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .flatMap((iface) => (iface === undefined ? [] : [iface.address]));
}

/** Step 5: re-seal under the active key; refuse or declare loss per 17 §17.5–17.6. */
export async function sweepSealed(
  ring: KeyRing,
  db: MetadataDb,
  config: Config
): Promise<SealedBoot> {
  const report = await sweep(ring, db);
  const framed = banner(report, ring);
  if (framed !== null) process.stderr.write(`${RULE}\n${framed}\n${RULE}\n`);
  if (report.unreadable.length > 0) {
    if (!config.TESTATE_SECRETS_ACCEPT_UNREADABLE) {
      const total = report.unreadable.length + report.reSealed + report.skipped;
      throw new SealedConfigError(
        `${report.unreadable.length} of ${total} stored sealed values open with no configured key; append the sealing key or set TESTATE_SECRETS_ACCEPT_UNREADABLE=true`
      );
    }
    disableUnreadableOwners(db, report, new Date().toISOString());
    for (const item of report.unreadable) {
      process.stderr.write(
        `unreadable sealed value: ${item.table}.${item.column} row ${item.rowId} (key ${item.kid})\n`
      );
    }
  }
  return { reSealed: report.reSealed, unreadable: report.unreadable, banner: framed };
}

/** Step 7: the first admin comes from the environment while `users` is empty. */
export async function bootstrapAdmin(
  userCount: number,
  users: UsersService,
  config: Config
): Promise<Bootstrap> {
  const password = config.TESTATE_ADMIN_PASSWORD;
  if (password === undefined) {
    if (userCount > 0) return { bootstrapped: false, bootstrap: null };
    throw new ConfigError([
      { variable: "TESTATE_ADMIN_PASSWORD", message: "required while the users table is empty" },
    ]);
  }
  const bootstrap = (): Promise<boolean> => users.bootstrap(config.TESTATE_ADMIN_USER, password);
  return { bootstrapped: userCount === 0 ? await bootstrap() : false, bootstrap };
}

export type JobsRuntime = { jobs: JobsService; dispatcher: Dispatcher };

/** The jobs runtime (spec 16): repository, event hub, dispatcher, service, and this build's runners. */
export function createJobsRuntime(
  db: MetadataDb,
  logger: Logger,
  audit: AuditService,
  config: Config,
  now: () => Date,
  runners: Omit<RunnerDeps, "db" | "audit" | "now">
): JobsRuntime {
  const repo = createJobsRepository(db);
  const hub = createJobEventHub();
  const dispatcher = createDispatcher({
    repo,
    hub,
    events: logger,
    cap: config.TESTATE_JOB_CONCURRENCY,
    now,
  });
  const jobs = createJobsService({
    repo,
    hub,
    dispatcher,
    db,
    dataDir: config.TESTATE_DATA_DIR,
    now,
  });
  registerRunners(dispatcher, { ...runners, db, audit, now });
  return { jobs, dispatcher };
}

export type EngineWiring = Omit<RunnerDeps, "db" | "audit" | "now" | "hooks"> & {
  requests: RestRepository;
  hooks: HooksRepository;
  data: DataRepository;
  probe: ProbeFn;
  fileProbe: FileProbeFn;
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
  return {
    engines,
    probe: createEngineProbe(engines, createScaffoldProbe()),
    fileProbe: createHttpProbe(createScaffoldFileProbe()),
    blobs: createLocalBlobStore(join(config.TESTATE_DATA_DIR, "blobs")),
    ring,
    adapters: createAdaptersRepository(db),
    states: createStatesRepository(db),
    checkouts: createCheckoutsRepository(db),
    requests: createRestRepository(db),
    hooks: createHooksRepository(db),
    data: createDataRepository(db),
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
  return { repo: wiring.states, projects, adapters: wiring.adapters, jobs, audit, now };
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
};

export function createStateServices(
  wiring: EngineWiring,
  projects: ProjectsRepository,
  jobs: JobsService,
  audit: AuditService,
  settings: { get(): Promise<Settings> },
  now: () => Date
): StateServices {
  return {
    states: createStatesService(statesDeps(wiring, projects, jobs, audit, now)),
    checkouts: createCheckoutsService(checkoutsDeps(wiring, projects, jobs, audit, now)),
    data: createDataService({ ...wiring, repo: wiring.data, projects, jobs, settings, audit, now }),
  };
}

export type Retention = { start(): void; stop(): void };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Step 9 and the daily timer: sweep terminal jobs older than `retention.job_history_days` (16 §16.1). */
export function createRetention(
  logger: Logger,
  sweep: () => (days: number) => { deleted: number; stubbed: number },
  historyDays: () => Promise<number>
): Retention {
  let timer: ReturnType<typeof setInterval> | null = null;
  const run = async (): Promise<void> => {
    const swept = sweep()(await historyDays());
    const event = logger.create("job");
    event.add("op", { name: "retention:jobs", deleted: swept.deleted, stubbed: swept.stubbed });
    event.emit();
  };
  return {
    start() {
      void run();
      timer = setInterval(() => void run(), DAY_MS);
    },
    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
  };
}

/** Boot refusals print a framed message and exit 78 (configuration error), per 22 §22.2. */
export function refuse(cause: unknown): never {
  if (!(cause instanceof ConfigError) && !(cause instanceof SealedConfigError)) throw cause;
  process.stderr.write(`${RULE}\nTestate refused to start\n${cause.message}\n${RULE}\n`);
  process.exit(78);
}
