import type { Actor, AdapterDraft } from "@testate/shared";

import type { RequestMeta } from "../../lib/http/auth.ts";
import type { AdaptersService } from "../adapters/adapters.service.ts";
import type { JobsService } from "../jobs/jobs.service.ts";
import type { ProjectsService } from "../projects/projects.service.ts";
import type { StatesService } from "../states/states.service.ts";
import type { UsersService } from "../users/users.service.ts";

export type SeedKind = "dev" | "qa";

export type SeedCounts = {
  users: number;
  projects: number;
  adapters: number;
  states: number;
  /** Adapters the compose engines refused (not running, wrong port): named, never fatal. */
  warnings: string[];
};

export type SeedDeps = {
  users: Pick<UsersService, "create">;
  projects: Pick<ProjectsService, "create">;
  adapters: Pick<AdaptersService, "create">;
  states: Pick<StatesService, "snapshot">;
  /** Init snapshots run as jobs; the seeded state waits for them (16 §16.1 exclusivity). */
  jobs: Pick<JobsService, "wait">;
  /** Writes a sample file into the seeded storage adapter so the import wizard has a source (story 51). */
  sample: (path: string, body: string) => Promise<void>;
  /** The bootstrap admin's row; seeds act as it. */
  admin: () => { id: string; username: string; role: Actor["role"] } | null;
};

/** Known passwords for the dev seed only (19 §19.3); never used outside a dev box. */
export const DEV_PASSWORDS = { qa: "qa-password-1234", viewer: "viewer-password-1234" } as const;

const META: RequestMeta = { ip: "", user_agent: "seed", request_id: null };
const INIT_WAIT_SECONDS = 60;

/** MinIO's liveness endpoint: a REST target that is not the API itself, which 18 §18.3 refuses. */
export const SAMPLE_CSV_PATH = "imports/customers.csv";
const SAMPLE_CSV = "email,balance,big\nseed-1@x.io,1.5,1\nseed-2@x.io,2.5,2\n";

/** The dev sample writer: the compose MinIO bucket the `exports` adapter reads. */
export function devSampleWriter(): SeedDeps["sample"] {
  const client = new Bun.S3Client({
    endpoint: "http://127.0.0.1:9010",
    region: "us-east-1",
    bucket: "exports",
    accessKeyId: "testate",
    secretAccessKey: "testate-minio",
  });
  return async (path, body) => {
    await client.write(path, body);
  };
}

/** Adapters at the compose engines from `deploy/compose.engines.yml`, ports offset as documented there. */
export function devAdapters(): AdapterDraft[] {
  const database = (engine: AdapterDraft["engine"], name: string, port: number): AdapterDraft => ({
    kind: "database",
    engine,
    name,
    mode: "sandbox",
    config: { host: "127.0.0.1", port, database: "shop", user: "testate" },
    secrets: { password: "testate" },
  });
  return [
    database("postgres", "shop-postgres", 15432),
    database("mysql", "shop-mysql", 13306),
    database("mariadb", "shop-mariadb", 13307),
    {
      kind: "database",
      engine: "mongodb",
      name: "shop-mongo",
      mode: "sandbox",
      config: { connection_string_set: true },
      secrets: {
        connection_string: "mongodb://testate:testate@127.0.0.1:27017/shop?authSource=admin",
      },
    },
    {
      kind: "storage",
      engine: "s3",
      name: "exports",
      mode: "read_only",
      config: {
        bucket: "exports",
        region: "us-east-1",
        endpoint: "http://127.0.0.1:9010",
        virtual_hosted: false,
      },
      secrets: { access_key_id: "testate", secret_access_key: "testate-minio" },
    },
  ];
}

async function devSeed(deps: SeedDeps, admin: Actor): Promise<SeedCounts> {
  const counts: SeedCounts = { users: 1, projects: 0, adapters: 0, states: 0, warnings: [] };
  // Usernames follow the shared contract (3+ characters): the service does not re-check the handler's schema.
  for (const [username, role, password] of [
    ["qa-user", "qa", DEV_PASSWORDS.qa],
    ["viewer-user", "viewer", DEV_PASSWORDS.viewer],
  ] as const) {
    await deps.users.create(
      admin,
      { username, display_name: username, role, temporary_password: password },
      META
    );
    counts.users += 1;
  }
  const project = await deps.projects.create(
    admin,
    { slug: "demo", name: "Demo", description: "Seeded by reset-state" },
    META
  );
  counts.projects = 1;
  for (const draft of devAdapters()) {
    try {
      const { init_job } = await deps.adapters.create(admin, project.slug, draft, META);
      if (init_job !== null) await deps.jobs.wait(null, init_job.id, INIT_WAIT_SECONDS);
      counts.adapters += 1;
    } catch (cause: unknown) {
      counts.warnings.push(
        `${draft.name}: ${cause instanceof Error ? cause.message : String(cause)}`
      );
    }
  }
  if (counts.adapters > 0) {
    // Wait for it like the init snapshots above: the reset answers "states: 1", and a caller that
    // changes anything the job depends on before it finishes gets a state stuck at running.
    const { job } = await deps.states.snapshot(
      admin,
      project.slug,
      { name: "seeded-baseline" },
      META
    );
    await deps.jobs.wait(null, job.id, INIT_WAIT_SECONDS);
    counts.states = 1;
  }
  try {
    await deps.sample(SAMPLE_CSV_PATH, SAMPLE_CSV);
  } catch (cause: unknown) {
    counts.warnings.push(`exports: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  return counts;
}

/** `dev` fills a demo project against the compose engines; `qa` leaves the bootstrap admin only (19 §19.3). */
export function createSeeds(deps: SeedDeps): (kind: SeedKind) => Promise<SeedCounts> {
  return async (kind) => {
    const record = deps.admin();
    if (record === null) throw new Error("the bootstrap admin is missing after the reset");
    const admin: Actor = {
      kind: "user",
      id: record.id,
      label: record.username,
      role: record.role,
      agent: false,
    };
    if (kind === "qa") return { users: 1, projects: 0, adapters: 0, states: 0, warnings: [] };
    return devSeed(deps, admin);
  };
}
