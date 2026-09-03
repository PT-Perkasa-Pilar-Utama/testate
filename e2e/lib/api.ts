import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { request } from "@playwright/test";
import type { APIRequestContext, APIResponse } from "@playwright/test";

import { API_PORT, E2E_DIR } from "../../playwright.config.ts";
import { PASSWORDS, USERNAMES } from "./roles.ts";
import type { Role } from "./roles.ts";

export type AdapterRow = {
  id: string;
  name: string;
  kind: string;
  tier: string;
  engine: string;
  mode: string;
};

/** The demo project's adapters straight from the API, so specs address screens by id. */
export async function demoAdapters(role: Role = "viewer"): Promise<AdapterRow[]> {
  const context = await request.newContext({
    baseURL: `http://localhost:${API_PORT}/api/v1/`,
    extraHTTPHeaders: { "X-Testate-Request": "1" },
  });
  await context.post("auth/login", {
    data: { username: USERNAMES[role], password: PASSWORDS[role] },
  });
  const response = await context.get("projects/demo/adapters");
  if (!response.ok())
    throw new Error(`adapters as ${role}: ${response.status()} ${await response.text()}`);
  const body: { data: AdapterRow[] } = await response.json();
  await context.dispose();
  return body.data;
}

/**
 * One adapter per kind, tier, and mode. The screens are one component per tier, whichever engine
 * sits behind them, and `routes.e2e.ts` already loads every engine's screens once per role. A
 * crawl over all of them clicked the same table screen on four engines, a third of its time.
 * Mode is part of the key because a read-only file store hides the controls a sandbox one shows.
 */
export async function representativeAdapters(role: Role = "viewer"): Promise<AdapterRow[]> {
  const seen = new Map<string, AdapterRow>();
  for (const adapter of await demoAdapters(role)) {
    const key = `${adapter.kind}:${adapter.tier}:${adapter.mode}`;
    if (!seen.has(key)) seen.set(key, adapter);
  }
  return [...seen.values()];
}

/** One seeded adapter by engine or kind; a missing one is a seed failure, not a test branch. */
export async function demoAdapter(match: { engine?: string; kind?: string }): Promise<AdapterRow> {
  const found = (await demoAdapters()).find(
    (a) =>
      (match.engine === undefined || a.engine === match.engine) &&
      (match.kind === undefined || a.kind === match.kind)
  );
  if (found === undefined) throw new Error(`no seeded adapter matches ${JSON.stringify(match)}`);
  return found;
}

/** Awaits a request whose failure is expected (a cancelled query) without an unhandled rejection. */
export async function swallow(pending: Promise<unknown>): Promise<void> {
  try {
    await pending;
  } catch {
    // expected
  }
}

export async function firstTable(adapterId: string): Promise<string> {
  const [table] = await demoTables(adapterId);
  if (table === undefined) throw new Error(`adapter ${adapterId} has no tables`);
  return table;
}

/** The first table of an adapter, by engine, for a spec that only needs somewhere to work. */
export async function firstTableOf(engine: string): Promise<{ id: string; table: string }> {
  const adapter = await demoAdapter({ engine });
  return { id: adapter.id, table: await firstTable(adapter.id) };
}

export async function demoTables(adapterId: string): Promise<string[]> {
  const context = await request.newContext({
    baseURL: `http://localhost:${API_PORT}/api/v1/`,
    extraHTTPHeaders: { "X-Testate-Request": "1" },
  });
  await context.post("auth/login", {
    data: { username: USERNAMES.viewer, password: PASSWORDS.viewer },
  });
  const response = await context.get(`projects/demo/adapters/${adapterId}/schema`);
  if (!response.ok())
    throw new Error(`schema ${adapterId}: ${response.status()} ${await response.text()}`);
  const body: { data: { tables: { schema: string | null; name: string }[] } } =
    await response.json();
  await context.dispose();
  return body.data.tables.map((t) => (t.schema === null ? t.name : `${t.schema}.${t.name}`));
}

/**
 * The sub-screens an adapter offers: query/grid for databases, files for storage, and policies for
 * an admin only. Masking rules moved behind `admin` in the beta rework, so a qa or viewer caller
 * asking for that path would be testing the refusal screen, not the screen.
 */
export async function adapterScreens(adapter: AdapterRow, role: Role): Promise<string[]> {
  const base = `/projects/demo/adapters/${adapter.id}`;
  if (adapter.kind === "storage") return [`${base}/files`];
  const paths = [`${base}/query`];
  if (adapter.tier === "tabular" && role === "admin") paths.push(`${base}/policies`);
  const [table] = await demoTables(adapter.id);
  if (table !== undefined) paths.push(`${base}/tables/${encodeURIComponent(table)}`);
  return paths;
}

/** An API context signed in as a role, ready for mutations (the CSRF header is set). */
export async function apiContext(role: Role = "admin"): Promise<APIRequestContext> {
  const context = await request.newContext({
    baseURL: `http://localhost:${API_PORT}/api/v1/`,
    extraHTTPHeaders: { "X-Testate-Request": "1" },
  });
  const response = await context.post("auth/login", {
    data: { username: USERNAMES[role], password: PASSWORDS[role] },
  });
  if (!response.ok()) throw new Error(`login as ${role}: ${response.status()}`);
  return context;
}

/** An API context that authenticates with a bearer token instead of a session cookie. */
export async function bearerContext(token: string): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: `http://localhost:${API_PORT}/api/v1/`,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
}

export type CreatedToken = {
  token: string;
  record: { id: string; kind: string; project_ids: string[] | null; expires_at: string | null };
};

/** The `POST /tokens` body (09 §9.3): agent tokens take no role, standard ones require it. */
export type TokenDraft = {
  name: string;
  kind?: "standard" | "agent";
  role?: Role;
  project_ids?: string[] | null;
  expires_at?: string;
};

/** Creates an API token and returns the plaintext with its record; the caller revokes it. */
export async function createToken(
  admin: APIRequestContext,
  body: TokenDraft
): Promise<CreatedToken> {
  const response = await admin.post("tokens", { data: body });
  if (response.status() !== 201)
    throw new Error(`token: ${response.status()} ${await response.text()}`);
  const payload: { data: CreatedToken } = await response.json();
  return payload.data;
}

/** The demo project's id; every agent token is scoped to it. */
export async function demoProjectId(admin: APIRequestContext): Promise<string> {
  const body: { data: { id: string; slug: string }[] } = await (
    await admin.get("projects?limit=50")
  ).json();
  const demo = body.data.find((project) => project.slug === "demo");
  if (demo === undefined) throw new Error("the demo project is missing from the seed");
  return demo.id;
}

/** Polls a job until it leaves `running`/`queued`; the terminal job comes back. */
/**
 * Inserts one row into a table with an `email` column through a write session, so a comparison
 * against the live database finds something: one that finds nothing is discarded by its job.
 */
export async function insertRow(
  context: APIRequestContext,
  adapterId: string,
  table: string
): Promise<void> {
  const started = await context.post(`projects/demo/adapters/${adapterId}/write-sessions`, {
    data: { foreign_key_checks: true },
  });
  if (!started.ok()) throw new Error(`write session: ${started.status()} ${await started.text()}`);
  const session: { data: { id: string } } = await started.json();
  const edits = await context.post(
    `projects/demo/adapters/${adapterId}/tables/${encodeURIComponent(table)}/row-edits`,
    {
      data: {
        write_session_id: session.data.id,
        edits: [{ kind: "insert", values: { email: { kind: "function", name: "uuid_v7" } } }],
      },
    }
  );
  if (!edits.ok()) throw new Error(`insert: ${edits.status()} ${await edits.text()}`);
  await context.delete(`projects/demo/adapters/${adapterId}/write-sessions/${session.data.id}`);
}

export async function waitForJob(qa: APIRequestContext, jobId: string): Promise<JobRow> {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const body: { data: JobRow } = await (await qa.get(`jobs/${jobId}`)).json();
    if (!["queued", "running"].includes(body.data.status)) return body.data;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`job ${jobId} never finished`);
}

export type JobRow = { id: string; status: string; kind: string };
export type TakenState = { stateId: string; job: JobRow };

/** `POST /states` answers 202 with the state and its job; this waits the job out. */
export async function takeState(
  qa: APIRequestContext,
  name: string,
  adapterId: string,
  headers: { [name: string]: string } = {}
): Promise<TakenState> {
  const response = await qa.post("projects/demo/states", {
    data: { name, adapter_ids: [adapterId] },
    headers,
  });
  if (response.status() !== 202) throw new Error(`take ${name}: ${await response.text()}`);
  const body: { data: { state: { id: string }; job: JobRow } } = await response.json();
  return { stateId: body.data.state.id, job: await waitForJob(qa, body.data.job.id) };
}

/** Takes a state of one adapter and returns `table:blob_hash` for every table it stored. */
export async function stateHashes(
  qa: APIRequestContext,
  name: string,
  adapterId: string
): Promise<string[]> {
  const taken = await takeState(qa, name, adapterId);
  const detail: {
    data: { adapters: { tables: { schema: string | null; name: string; blob_hash: string }[] }[] };
  } = await (await qa.get(`projects/demo/states/${taken.stateId}`)).json();
  return detail.data.adapters
    .flatMap((adapter) => adapter.tables)
    .map((table) => `${table.schema ?? ""}.${table.name}:${table.blob_hash}`)
    .sort();
}

/** The refused half of two racing job requests. */
export function refusedOf(one: APIResponse, two: APIResponse): APIResponse {
  const refused = [one, two].find((response) => response.status() === 409);
  if (refused === undefined) throw new Error("neither request was refused");
  return refused;
}

/** Waits until no job holds the adapter, so the next test starts on an idle lane. */
export async function waitForIdle(qa: APIRequestContext, adapterId: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const running: { data: { adapter_ids: string[] }[] } = await (
      await qa.get("jobs?status=running&status=queued&limit=100")
    ).json();
    const busy = running.data.some((job) => job.adapter_ids.includes(adapterId));
    if (!busy) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`adapter ${adapterId} never went idle`);
}

/** Files in the local blob store; an unchanged table must not add one (05 §5.10). */
export function blobCount(): number {
  const dir = join(E2E_DIR, "data", "blobs");
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) =>
    entry.isFile()
  ).length;
}
