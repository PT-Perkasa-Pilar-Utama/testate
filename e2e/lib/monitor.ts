import type { APIRequestContext, Page } from "@playwright/test";

export type ReadingValue = { key: string; value: number; unit: string };
export type Reading = {
  id: string;
  taken_at: string;
  adapters: { adapter_id: string; source: string; values: ReadingValue[] }[];
};

/** "Sample now" over the API: one reading of every host and server behind the demo project. */
export async function takeReading(qa: APIRequestContext): Promise<Reading> {
  const response = await qa.post("projects/demo/readings");
  if (response.status() !== 201)
    throw new Error(`reading: ${response.status()} ${await response.text()}`);
  const body: { data: Reading } = await response.json();
  return body.data;
}

export async function readingById(context: APIRequestContext, id: string): Promise<Reading> {
  const body: { data: Reading } = await (await context.get(`projects/demo/readings/${id}`)).json();
  return body.data;
}

function serverOf(reading: Reading, adapterId: string): ReadingValue[] {
  const server = reading.adapters.find(
    (adapter) => adapter.adapter_id === adapterId && adapter.source === "server"
  );
  if (server === undefined) throw new Error(`reading ${reading.id} has no server ${adapterId}`);
  return server.values;
}

/** One database server value from a reading; a value the reading lacks is a failure, not a zero. */
export function serverValue(reading: Reading, adapterId: string, key: string): number {
  const found = serverOf(reading, adapterId).find((value) => value.key === key);
  if (found === undefined) throw new Error(`reading ${reading.id} did not read ${key}`);
  return found.value;
}

/** The keys a server reading holds, sorted, so two readings can be lined up. */
export function serverKeys(reading: Reading, adapterId: string): string[] {
  return serverOf(reading, adapterId)
    .map((value) => value.key)
    .sort();
}

/** Points in the series line of one server value over the last ten minutes, a second a bucket. */
export async function seriesPoints(
  context: APIRequestContext,
  adapterId: string,
  key: string
): Promise<number> {
  const from = new Date(Date.now() - 10 * 60_000).toISOString();
  const query = new URLSearchParams({ from, step: "1" });
  const body: {
    data: { lines: { adapter_id: string; source: string; key: string; points: unknown[] }[] };
  } = await (await context.get(`projects/demo/readings/series?${query.toString()}`)).json();
  const line = body.data.lines.find(
    (item) => item.adapter_id === adapterId && item.source === "server" && item.key === key
  );
  return line?.points.length ?? 0;
}

/** Opens a write session on an adapter as the caller and ends it, so the audit names them last. */
export async function startAndEndWriting(
  context: APIRequestContext,
  adapterId: string
): Promise<void> {
  const base = `projects/demo/adapters/${adapterId}/write-sessions`;
  let opened = await context.post(base, { data: { foreign_key_checks: true } });
  if (opened.status() === 409) {
    // Another spec left one open; end it, so the session started here is a fresh audit row.
    const stale: { error: { details: { write_session_id: string } } } = await opened.json();
    await context.delete(`${base}/${stale.error.details.write_session_id}`);
    opened = await context.post(base, { data: { foreign_key_checks: true } });
  }
  if (opened.status() !== 201)
    throw new Error(`write session: ${opened.status()} ${await opened.text()}`);
  const body: { data: { id: string } } = await opened.json();
  await context.delete(`${base}/${body.data.id}`);
}

/**
 * Clicks "Sample now" and answers the status of the reading it took. Waiting for the button to be
 * enabled again raced the click: the second click could land while the first reading still ran.
 */
export async function sampleNow(page: Page): Promise<number> {
  const taken = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().endsWith("/readings")
  );
  await page.getByRole("button", { name: "Sample now" }).click();
  return (await taken).status();
}
