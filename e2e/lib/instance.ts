import type { Booted } from "./boot.ts";

/** Requests against an instance `lib/boot.ts` spawned: sign in, seed, and drive its jobs. */
export type AdminSession = { base: string; cookie: string };

const FIRST = "boot-admin-password-1";
const FINAL = "boot-admin-password-2";

type PasswordChange = { current: string; next: string };

async function post(session: AdminSession, path: string, body: PasswordChange): Promise<Response> {
  return fetch(`${session.base}/api/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Testate-Request": "1",
      cookie: session.cookie,
    },
    body: JSON.stringify(body),
  });
}

async function login(base: string, password: string): Promise<string | null> {
  const response = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Testate-Request": "1" },
    body: JSON.stringify({ username: "admin", password }),
  });
  if (!response.ok) return null;
  return (response.headers.getSetCookie().at(0) ?? "").split(";")[0] ?? "";
}

/**
 * Signs the bootstrap admin in. A fresh instance forces the temporary password out of the way
 * (09 §9.2); an instance this suite already visited answers to the rotated one.
 */
export async function adminSession(base: string): Promise<AdminSession> {
  const rotated = await login(base, FINAL);
  if (rotated !== null) return { base, cookie: rotated };
  const cookie = await login(base, FIRST);
  if (cookie === null) throw new Error(`boot login refused both passwords`);
  const session = { base, cookie };
  const changed = await post(session, "auth/password", { current: FIRST, next: FINAL });
  if (changed.status !== 204) throw new Error(`boot password: ${changed.status}`);
  return session;
}

/** Seals two S3 credentials in the settings, so the next boot has something to open. */
export async function sealS3Credentials(session: AdminSession): Promise<void> {
  const response = await fetch(`${session.base}/api/v1/settings`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "X-Testate-Request": "1",
      cookie: session.cookie,
    },
    body: JSON.stringify({
      store: {
        s3: {
          bucket: "snapshots",
          prefix: "boot",
          region: null,
          endpoint: "http://minio.sit.internal:9000",
          virtual_hosted: false,
          access_key_id: "AKIABOOT",
          secret_access_key: "boot-secret",
        },
      },
    }),
  });
  if (!response.ok) throw new Error(`seal settings: ${response.status} ${await response.text()}`);
}

export type Reply<T> = { status: number; json: T };

/** What a request body may hold: JSON, or nothing at all. */
export type RequestBody =
  | string
  | number
  | boolean
  | null
  | RequestBody[]
  | { [key: string]: RequestBody };

/** One request on a spawned instance as the signed-in admin; the caller names the payload type. */
export async function call<T>(
  session: AdminSession,
  method: string,
  path: string,
  body?: RequestBody
): Promise<Reply<T>> {
  const response = await fetch(`${session.base}/api/v1/${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "X-Testate-Request": "1",
      cookie: session.cookie,
    },
    body: body === undefined ? null : JSON.stringify(body),
  });
  const text = await response.text();
  // A 204 answers with no body; every other route answers JSON.
  const json: T = text === "" ? JSON.parse("null") : JSON.parse(text);
  return { status: response.status, json };
}

export type PostgresDraft = {
  kind: "database";
  engine: "postgres";
  name: string;
  config: { host: string; port: number; database: string; user: string };
  secrets: { password: string };
};

/** A draft against the compose Postgres, with the host and database under test. */
export function draftFor(host: string, name = "probe", database = "shop"): PostgresDraft {
  return {
    kind: "database",
    engine: "postgres",
    name,
    config: { host, port: 15432, database, user: "testate" },
    secrets: { password: "testate" },
  };
}

/** A project with one Postgres adapter on a spawned instance; loopback is lifted first. */
export async function seedProject(
  session: AdminSession,
  slug: string,
  database = "shop"
): Promise<string> {
  await call(session, "PATCH", "settings", { netguard: { deny: [] } });
  const project = await call<unknown>(session, "POST", "projects", { slug, name: slug });
  if (project.status !== 201) throw new Error(`project ${slug}: ${JSON.stringify(project.json)}`);
  const created = await call<{ data: { adapter: { id: string } } }>(
    session,
    "POST",
    `projects/${slug}/adapters`,
    draftFor("127.0.0.1", "shop", database)
  );
  if (created.status !== 201) throw new Error(`adapter: ${JSON.stringify(created.json)}`);
  return created.json.data.adapter.id;
}

/** Waits until the instance runs no job, so the next step starts on an idle dispatcher. */
export async function waitIdle(session: AdminSession): Promise<void> {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const jobs = await call<{ data: unknown[] }>(
      session,
      "GET",
      "jobs?status=running&status=queued&limit=50"
    );
    if (jobs.json.data.length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("the instance never went idle");
}

/**
 * Starts a snapshot and kills the instance while the job runs, so the next boot finds a `running`
 * row. A snapshot of the demo database is quick, so this retries until it catches one mid-flight.
 */
export async function killDuringSnapshot(
  session: AdminSession,
  booted: Booted,
  slug: string,
  adapterId: string
): Promise<string> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const started = await call<{ data: { job: { id: string } } }>(
      session,
      "POST",
      `projects/${slug}/states`,
      { name: `killed-${attempt}`, adapter_ids: [adapterId] }
    );
    const jobId = started.json.data.job.id;
    for (let poll = 0; poll < 60; poll += 1) {
      const job = await call<{ data: { status: string } }>(session, "GET", `jobs/${jobId}`);
      if (job.json.data.status === "running") {
        await booted.stop("SIGKILL");
        return jobId;
      }
      if (job.json.data.status !== "queued") break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error("no snapshot job stayed running long enough to interrupt");
}

export type JobRow = { data: { status: string; result: RequestBody } };

/** Waits for a job on a spawned instance to leave `queued`/`running`. */
export async function waitJob(session: AdminSession, jobId: string): Promise<JobRow["data"]> {
  for (let attempt = 0; attempt < 480; attempt += 1) {
    const job = await call<JobRow>(session, "GET", `jobs/${jobId}`);
    if (!["queued", "running"].includes(job.json.data.status)) return job.json.data;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`job ${jobId} never finished`);
}

export type TakenState = { jobId: string; stateId: string };

/** Takes a state of one adapter on a spawned instance and returns once the job settles. */
export async function takeStateOn(
  session: AdminSession,
  slug: string,
  adapterId: string,
  name: string
): Promise<TakenState> {
  const started = await call<{ data: { state: { id: string }; job: { id: string } } }>(
    session,
    "POST",
    `projects/${slug}/states`,
    { name, adapter_ids: [adapterId] }
  );
  if (started.status !== 202) throw new Error(`take ${name}: ${JSON.stringify(started.json)}`);
  await waitJob(session, started.json.data.job.id);
  return { jobId: started.json.data.job.id, stateId: started.json.data.state.id };
}

/** Runs `during` the moment a job reports `running`, and says what it managed to do. */
export async function whileJobRuns(
  session: AdminSession,
  jobId: string,
  during: () => void
): Promise<string> {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const job = await call<{ data: { status: string } }>(session, "GET", `jobs/${jobId}`);
    if (job.json.data.status === "running") {
      during();
      return "ran while the job was running";
    }
    if (job.json.data.status !== "queued") return `the job was ${job.json.data.status} already`;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return "the job never started";
}

export type SignedIn = { cookie: string; mustChangePassword: boolean };

/** Signs in with a given password and reports whether the instance forces a change. */
export async function signIn(base: string, password: string): Promise<SignedIn> {
  const response = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Testate-Request": "1" },
    body: JSON.stringify({ username: "admin", password }),
  });
  if (!response.ok) throw new Error(`sign in: ${response.status} ${await response.text()}`);
  const body: { data: { must_change_password: boolean } } = await response.json();
  return {
    cookie: (response.headers.getSetCookie().at(0) ?? "").split(";")[0] ?? "",
    mustChangePassword: body.data.must_change_password,
  };
}
