import type { Actor, Adapter, AdapterDraft } from "@testate/shared";
import * as v from "valibot";

import { createMemoryBlobStore } from "../src/lib/blobstore/index.ts";
import type { BlobStore } from "../src/lib/blobstore/index.ts";
import { createFakeEngine } from "../src/lib/engines/fake/engine.ts";
import type { FakeDatabase, FakeEngineOptions } from "../src/lib/engines/fake/engine.ts";
import type { DbEngine, EngineRegistry } from "../src/lib/engines/index.ts";
import type { Check, Verdict } from "../src/lib/netguard/index.ts";
import { loadKeyRing, open } from "../src/lib/sealed/index.ts";
import type { KeyRing } from "../src/lib/sealed/index.ts";
import { aadFor } from "../src/lib/sealed/registry.ts";
import {
  createScaffoldFileProbe,
  createScaffoldProbe,
} from "../src/modules/adapters/adapters.probe.ts";
import { createAdaptersRepository } from "../src/modules/adapters/adapters.repository.ts";
import type { AdaptersRepository } from "../src/modules/adapters/adapters.repository.ts";
import { createAdaptersService } from "../src/modules/adapters/adapters.service.ts";
import { createStatesRepository } from "../src/modules/states/states.repository.ts";
import type { StatesRepository } from "../src/modules/states/states.repository.ts";
import { registerRunners } from "../src/modules/jobs/jobs.runners.ts";
import type { AdaptersService } from "../src/modules/adapters/adapters.service.ts";
import { secretsSchema } from "../src/modules/adapters/adapters.secrets.ts";
import type { Secrets } from "../src/modules/adapters/adapters.secrets.ts";
import { TEST_META, actorOf, createAccounts } from "./accounts.ts";
import { createJobsHarness } from "./jobs.ts";
import type { JobsHarness } from "./jobs.ts";
import type { AccountsHarness } from "./accounts.ts";

export const PROJECT_ID = "01991f00-0000-7000-8000-000000000010";

export const PG: AdapterDraft = {
  kind: "database",
  engine: "postgres",
  name: "orders-db",
  mode: "sandbox",
  config: { host: "pg.sit.internal", port: 5432, database: "shop", user: "testate" },
  secrets: { password: "pg-secret" },
};

export const S3: AdapterDraft = {
  kind: "storage",
  engine: "s3",
  name: "exports",
  mode: "sandbox",
  config: {
    bucket: "exports",
    region: "ap-southeast-1",
    endpoint: "https://minio.sit.internal:9000",
  },
  secrets: { access_key_id: "AKIA", secret_access_key: "s3-secret" },
};

export type AdaptersHarness = {
  adapters: AdaptersService;
  repo: AdaptersRepository;
  ring: KeyRing;
  admin: Actor;
  qa: Actor;
  advance: (ms: number) => void;
  audit: AccountsHarness["audit"];
  /** Hosts the stub policy blocks; mutate it to change verdicts mid-test. */
  blocked: Set<string>;
  runtime: JobsHarness;
  /** Fake databases by name; the `shop` database starts with two tables. */
  databases: Map<string, FakeDatabase>;
  blobs: BlobStore;
  states: StatesRepository;
  projectsRepo: AccountsHarness["projectsRepo"];
  db: AccountsHarness["db"];
};

/** A registry with one fake postgres engine; other engines are absent, as in the real build. */
export function fakeRegistry(opts: FakeEngineOptions): EngineRegistry {
  const engine: DbEngine = createFakeEngine(opts);
  return {
    get: (name) => (name === "postgres" ? engine : null),
    require(name) {
      if (name !== "postgres") throw new Error(`${name} has no engine in the test registry`);
      return engine;
    },
  };
}

export function shopDatabase(): FakeDatabase {
  return new Map([
    [
      "public.customers",
      [
        { id: 1, email: "a@x.io" },
        { id: 2, email: "b@x.io" },
      ],
    ],
    ["public.orders", [{ id: 1, customer_id: 1, total: "10.00" }]],
  ]);
}

type Netguard = { check(input: Check): Promise<Verdict> };

/** Verdicts by host name: `blocked` hosts hit the policy, `.invalid` hosts never resolve, the rest pass. */
function stubNetguard(blocked: Set<string>): Netguard {
  return {
    async check(input) {
      if (blocked.has(input.host)) return { allowed: false, reason: "policy", matched: input.host };
      if (input.host.endsWith(".invalid")) {
        return { allowed: false, reason: "unresolvable", matched: input.host };
      }
      return { allowed: true, addresses: ["10.0.0.5"] };
    },
  };
}

/** Creates an adapter and waits for its init snapshot job, so the adapter is free for the next job. */
export async function createSettled(
  harness: AdaptersHarness,
  draft: AdapterDraft
): Promise<Adapter> {
  const { adapter, init_job } = await harness.adapters.create(harness.qa, "shop", draft, TEST_META);
  if (init_job !== null) await harness.runtime.jobs.wait(null, init_job.id, 5);
  return adapter;
}

/** The stored secrets of an adapter, opened with the harness ring. */
export async function storedSecrets(harness: AdaptersHarness, id: string): Promise<Secrets> {
  const row = harness.repo.byId(id);
  if (row === null) throw new Error(`adapter ${id} is missing`);
  return v.parse(
    secretsSchema,
    JSON.parse(await open(harness.ring, row.config_sealed, aadFor("adapters", "config_sealed", id)))
  );
}

/** Real repository and service on the accounts harness, with a stub policy and the scaffold probes. */
export async function createAdaptersHarness(): Promise<AdaptersHarness> {
  const accounts = await createAccounts();
  const qaUser = await accounts.users.create(
    accounts.admin,
    {
      username: "dina.qa",
      display_name: "Dina",
      role: "qa",
      temporary_password: "temporary-password-1",
    },
    TEST_META
  );
  accounts.projectsRepo.insert({
    id: PROJECT_ID,
    slug: "shop",
    name: "Shop",
    description: null,
    quota_bytes: null,
    created_by: accounts.admin.id,
    created_at: accounts.now().toISOString(),
  });
  const ring = await loadKeyRing(
    Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64")
  );
  const repo = createAdaptersRepository(accounts.db);
  const blocked = new Set<string>();
  const scaffold = createScaffoldProbe();
  const runtime = createJobsHarness(accounts.db, accounts.now);
  const databases = new Map<string, FakeDatabase>([["shop", shopDatabase()]]);
  const blobs = createMemoryBlobStore();
  const states = createStatesRepository(accounts.db);
  registerRunners(runtime.dispatcher, {
    db: accounts.db,
    audit: accounts.audit,
    now: accounts.now,
    engines: fakeRegistry({ databases }),
    blobs,
    ring,
    adapters: repo,
    states,
    projects: accounts.projectsRepo,
  });
  runtime.dispatcher.start();
  const adapters = createAdaptersService({
    repo,
    projects: accounts.projectsRepo,
    audit: accounts.audit,
    ring,
    netguard: stubNetguard(blocked),
    // The database named "ancient" answers below the floor, so ENGINE_UNSUPPORTED has a path.
    probe: async (engine, config, secrets) => {
      const result = await scaffold(engine, config, secrets);
      return config["database"] === "ancient"
        ? { ...result, version: "9.6", meets_floor: false }
        : result;
    },
    fileProbe: createScaffoldFileProbe(),
    jobs: runtime.jobs,
    now: accounts.now,
  });
  return {
    adapters,
    repo,
    ring,
    admin: accounts.admin,
    qa: actorOf(qaUser),
    advance: accounts.advance,
    audit: accounts.audit,
    blocked,
    runtime,
    databases,
    blobs,
    states,
    projectsRepo: accounts.projectsRepo,
    db: accounts.db,
  };
}
