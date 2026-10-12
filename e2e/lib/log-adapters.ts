import { spawn } from "node:child_process";
import { join } from "node:path";
import type { APIRequestContext } from "@playwright/test";

import type { Json } from "./fakes.ts";
import { pgUrl, runSql } from "./sql.ts";
import type { LockHolder } from "./sql.ts";

const ROOT = join(import.meta.dirname, "..", "..");

export type LogDraft = {
  kind: "logs";
  engine: "loki" | "elasticsearch" | "docker" | "journald" | "ingest";
  name: string;
  config: { [key: string]: Json };
  secrets: { [key: string]: string };
};
export type CreatedLogAdapter = { id: string; ingest_token: string | null };
export type LogsPage = { entries: { message: string; masked: boolean }[] };

/** A log adapter in the demo project, made through the API; an ingest one answers with its token. */
export async function createLogAdapter(
  qa: APIRequestContext,
  draft: LogDraft
): Promise<CreatedLogAdapter> {
  const response = await qa.post("projects/demo/adapters", { data: draft });
  if (response.status() !== 201)
    throw new Error(`${draft.name}: ${response.status()} ${await response.text()}`);
  const body: { data: { adapter: { id: string }; ingest_token?: string | null } } =
    await response.json();
  return { id: body.data.adapter.id, ingest_token: body.data.ingest_token ?? null };
}

export async function readLogs(
  context: APIRequestContext,
  id: string,
  source: string
): Promise<LogsPage> {
  const response = await context.get(`projects/demo/adapters/${id}/logs?source=${source}`);
  if (!response.ok()) throw new Error(`logs ${id}: ${response.status()} ${await response.text()}`);
  const body: { data: LogsPage } = await response.json();
  return body.data;
}

export const messagesOf = (page: LogsPage): string[] => page.entries.map((entry) => entry.message);

/** The id a spec stored under a name; a missing one is a setup failure, not a test branch. */
export function idIn(ids: ReadonlyMap<string, string>, name: string): string {
  const id = ids.get(name);
  if (id === undefined) throw new Error(`no ${name} adapter was made`);
  return id;
}

/**
 * A session on the demo `shop` that sits in `pg_stat_activity` with a marked statement until it is
 * killed. It reads only, so the rule that nothing writes to `shop` behind the API holds.
 */
export function holdStatement(marker: string): LockHolder {
  const child = spawn("bun", ["scripts/e2e-sql.ts", pgUrl("shop")], { cwd: ROOT, stdio: "pipe" });
  child.stdin.end(JSON.stringify([`SELECT '${marker}' AS marker, pg_sleep(60)`]));
  return { release: () => child.kill("SIGKILL") };
}

/** Waits until another session shows the statement, so the page does not race the spawn. */
export async function awaitStatement(marker: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const rows = runSql<{ n: number }[]>("shop", [
      `SELECT count(*)::int AS n FROM pg_stat_activity
       WHERE pid <> pg_backend_pid() AND query LIKE '%${marker}%'`,
    ]);
    if ((rows[0]?.n ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`no session ever ran ${marker}`);
}
