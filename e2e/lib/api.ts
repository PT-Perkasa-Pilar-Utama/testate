import { request } from "@playwright/test";

import { API_PORT } from "../../playwright.config.ts";
import { PASSWORDS, USERNAMES } from "./roles.ts";
import type { Role } from "./roles.ts";

export type AdapterRow = { id: string; name: string; kind: string; tier: string; engine: string };

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

/** The sub-screens an adapter offers: query/policies/grid for databases, files for storage, requests for REST. */
export async function adapterScreens(adapter: AdapterRow): Promise<string[]> {
  const base = `/projects/demo/adapters/${adapter.id}`;
  if (adapter.kind === "storage") return [`${base}/files`];
  if (adapter.kind === "rest") return [`${base}/requests`];
  const paths = [`${base}/query`];
  if (adapter.tier === "tabular") paths.push(`${base}/policies`);
  const [table] = await demoTables(adapter.id);
  if (table !== undefined) paths.push(`${base}/tables/${encodeURIComponent(table)}`);
  return paths;
}
