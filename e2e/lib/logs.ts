import { readFileSync } from "node:fs";
import type { APIRequestContext, APIResponse, Download, Locator, Page } from "@playwright/test";

import { bearerContext } from "./api.ts";

/** The compose MinIO bucket the seeded `exports` store reads (deploy/compose.engines.yml). */
export const MINIO = {
  bucket: "exports",
  region: "us-east-1",
  endpoint: "http://127.0.0.1:9010",
  access_key_id: "testate",
  secret_access_key: "testate-minio",
} as const;

/** One pushed or file line in the shape the `testate` and `json-lines` formats both read. */
export type LogLine = { ts: string; level: string; message: string; service?: { name: string } };

async function dataOf<T>(response: APIResponse): Promise<T> {
  if (!response.ok())
    throw new Error(`${response.url()}: ${response.status()} ${await response.text()}`);
  const body: { data: T } = await response.json();
  return body.data;
}

/** A throwaway project for one spec's log adapters, so no seeded job or screen grows a Logs menu. */
export async function createProject(admin: APIRequestContext, slug: string): Promise<void> {
  await dataOf(await admin.post("projects", { data: { slug, name: slug } }));
}

/** Deletes a project and every adapter in it; there is no database to restore. */
export async function deleteProject(admin: APIRequestContext, slug: string): Promise<void> {
  const plan = await dataOf<{ plan_id: string }>(await admin.get(`projects/${slug}/deletion-plan`));
  await dataOf(
    await admin.post(`projects/${slug}/deletion`, {
      data: { confirm_slug: slug, plan_id: plan.plan_id, adapters: [] },
    })
  );
}

export type Created = { id: string; token: string };

/** An `ingest` adapter and its push token, which this answer alone carries (I8). */
export async function createIngest(
  qa: APIRequestContext,
  slug: string,
  name: string
): Promise<Created> {
  const created = await dataOf<{ adapter: { id: string }; ingest_token: string | null }>(
    await qa.post(`projects/${slug}/adapters`, {
      data: { kind: "logs", engine: "ingest", name, config: {}, secrets: {} },
    })
  );
  if (created.ingest_token === null) throw new Error(`${name}: no ingest token in the answer`);
  return { id: created.adapter.id, token: created.ingest_token };
}

/** Pushes lines the way an app does: bearer token, newline-separated JSON, no session. */
export async function push(adapter: Created, lines: LogLine[]): Promise<number> {
  const app = await bearerContext(adapter.token);
  const answer = await dataOf<{ accepted: number }>(
    await app.post(`ingest/${adapter.id}`, {
      data: lines.map((line) => JSON.stringify(line)).join("\n"),
      headers: { "Content-Type": "application/x-ndjson" },
    })
  );
  await app.dispose();
  return answer.accepted;
}

/**
 * `count` lines one second apart ending a few seconds ago, oldest first, as an app writes them.
 * Every fiftieth is an error, so a level filter has a known answer.
 */
export function requestLines(count: number, service: string): LogLine[] {
  const end = Date.now() - 5_000;
  return Array.from({ length: count }, (_, index) => ({
    ts: new Date(end - (count - 1 - index) * 1_000).toISOString(),
    level: index % 50 === 0 ? "error" : "info",
    message: index % 50 === 0 ? `checkout failed ${index}` : `request ${index} ok`,
    service: { name: service },
  }));
}

/** Starts a deletion job for an adapter: the cheapest job a project without databases can run. */
export async function deleteAdapter(
  qa: APIRequestContext,
  slug: string,
  id: string
): Promise<string> {
  const plan = await dataOf<{ plan_id: string; adapter: { action: string } }>(
    await qa.get(`projects/${slug}/adapters/${id}/deletion-plan`)
  );
  const job = await dataOf<{ id: string }>(
    await qa.post(`projects/${slug}/adapters/${id}/deletion`, {
      data: { plan_id: plan.plan_id, action: plan.adapter.action },
    })
  );
  return job.id;
}

/** A logfile adapter over the compose bucket, one `json-lines` source with its own mask. */
export async function createBucketLogs(
  qa: APIRequestContext,
  slug: string,
  name: string,
  glob: string,
  patterns: string[]
): Promise<string> {
  const { access_key_id, secret_access_key, ...bucket } = MINIO;
  const created = await dataOf<{ adapter: { id: string } }>(
    await qa.post(`projects/${slug}/adapters`, {
      data: {
        kind: "logs",
        engine: "logfile",
        name,
        config: {
          transport: "s3",
          ...bucket,
          virtual_hosted: false,
          sources: [{ name: "api", glob, format: "json-lines", patterns }],
        },
        secrets: { access_key_id, secret_access_key },
      },
    })
  );
  return created.adapter.id;
}

/** A log adapter as the Logs screen lists it. */
export async function logAdapter(
  context: APIRequestContext,
  name: string
): Promise<{ id: string; mode: string; engine: string }> {
  const all = await dataOf<{ id: string; name: string; mode: string; engine: string }[]>(
    await context.get("log-adapters")
  );
  const found = all.find((adapter) => adapter.name === name);
  if (found === undefined) throw new Error(`no log adapter named ${name}`);
  return found;
}

/** The viewer's entries, one `<li>` each; a Fields fold inside one is not an entry of its own. */
export function entries(page: Page): Locator {
  return page.locator("main li:has(> div > pre)");
}

/** An entry's message: the first `<pre>`, before any Fields fold. */
export function messageOf(entry: Locator): Locator {
  return entry.locator("> div > pre");
}

/** The JSON lines a download saved, parsed. */
export async function downloadedLines(
  download: Download
): Promise<{ message: string; masked: boolean }[]> {
  const path = await download.path();
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}
