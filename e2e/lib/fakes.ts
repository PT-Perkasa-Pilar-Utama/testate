import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

/**
 * Log servers the compose file has no service for (stories 160 to 163): small fakes on loopback
 * that answer only the calls a Testate log adapter makes, in the shapes the engines send. The API
 * dials them like the real thing, so the read path from the adapter to the screen is the real one.
 */
export type FakeHost = { port: number; close: () => Promise<void> };

/** One line a fake holds: when it was written, which service or container wrote it, and its text. */
export type FakeLine = { at: number; service: string; text: string };

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type Answer = { status: number; type: string; body: string | Buffer };
type Route = (url: URL, body: string) => Answer;

const ROOT = join(import.meta.dirname, "..", "..");

const json = (body: Json, status = 200): Answer => ({
  status,
  type: "application/json",
  body: JSON.stringify(body),
});

const isInfo = (address: AddressInfo | string | null): address is AddressInfo =>
  address !== null && Object.hasOwn(Object(address), "port");

async function bodyOf(request: IncomingMessage): Promise<string> {
  const parts: Buffer[] = [];
  for await (const part of request) parts.push(Buffer.from(part));
  return Buffer.concat(parts).toString();
}

async function serve(route: Route): Promise<FakeHost> {
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const answer = route(new URL(request.url ?? "/", "http://fake"), await bodyOf(request));
    response.writeHead(answer.status, { "Content-Type": answer.type });
    response.end(answer.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!isInfo(address)) throw new Error("the fake has no TCP address");
  return {
    port: address.port,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** A stamp with nanoseconds, as Loki, Elasticsearch and Docker each write one. */
export function nanoStamp(at: number): string {
  return new Date(at).toISOString().replace("Z", "000000Z");
}

const nanosOf = (at: number): bigint => BigInt(at) * 1_000_000n;

/** `{service="api"}`: the one label the fake streams carry. */
const serviceOf = (selector: string): string => /service\s*=\s*"([^"]*)"/.exec(selector)?.[1] ?? "";

/**
 * Loki 3: `labels` and `query_range` with `start` inclusive, `end` exclusive, `limit` lines from
 * the `direction` end, one stream per service label.
 */
export function fakeLoki(lines: FakeLine[]): Promise<FakeHost> {
  return serve((url) => {
    if (url.pathname === "/loki/api/v1/labels")
      return json({ status: "success", data: ["service"] });
    if (url.pathname !== "/loki/api/v1/query_range") return json({ message: "not found" }, 404);
    const start = BigInt(url.searchParams.get("start") ?? "0");
    const end = url.searchParams.get("end");
    const service = serviceOf(url.searchParams.get("query") ?? "");
    const backward = url.searchParams.get("direction") === "backward";
    const kept = lines
      .filter((line) => line.service === service)
      .filter(
        (line) => nanosOf(line.at) >= start && (end === null || nanosOf(line.at) < BigInt(end))
      )
      .sort((a, b) => (backward ? b.at - a.at : a.at - b.at))
      .slice(0, Number(url.searchParams.get("limit") ?? "100"));
    const values = kept.map((line) => [String(nanosOf(line.at)), line.text]);
    const result = values.length === 0 ? [] : [{ stream: { service }, values }];
    return json({ status: "success", data: { resultType: "streams", result } });
  });
}

type Range = { gte?: string; lte?: string };
type SearchBody = {
  size: number;
  sort: { "@timestamp": { order: "asc" | "desc" } }[];
  query: {
    bool: {
      filter: { range?: { "@timestamp": Range } }[];
      must: { query_string: { query: string } }[];
    };
  };
};

/** Lucene's `field:value` on the service field, or a word in the message: enough for the specs. */
function queryMatches(query: string, line: FakeLine): boolean {
  const [field, value] = query.split(":");
  if (value === undefined) return line.text.includes(query);
  return field === "service" && line.service === value;
}

function inRange(range: Range | undefined, at: number): boolean {
  const from = range?.gte === undefined ? -Infinity : Date.parse(range.gte);
  const to = range?.lte === undefined ? Infinity : Date.parse(range.lte);
  return at >= from && at <= to;
}

/**
 * Elasticsearch 8: `GET /` names the version, `POST /logs-*\/_search` answers the query string on
 * `@timestamp`, sorted as asked, every document in the index `logs-shop`.
 */
export function fakeElasticsearch(lines: FakeLine[]): Promise<FakeHost> {
  return serve((url, raw) => {
    if (url.pathname === "/")
      return json({ name: "e2e", version: { number: "8.15.0", distribution: "elasticsearch" } });
    if (!/^\/logs-[^/]*\/_search$/.test(url.pathname))
      return json({ error: { type: "index_not_found_exception", reason: "no such index" } }, 404);
    const body: SearchBody = JSON.parse(raw);
    const range = body.query.bool.filter.find((clause) => clause.range !== undefined)?.range;
    const query = body.query.bool.must[0]?.query_string.query ?? "";
    const descending = body.sort[0]?.["@timestamp"].order === "desc";
    const hits = lines
      .map((line, at) => ({ line, id: `doc-${at}` }))
      .filter(({ line }) => query === "" || queryMatches(query, line))
      .filter(({ line }) => inRange(range?.["@timestamp"], line.at))
      .sort((a, b) => (descending ? b.line.at - a.line.at : a.line.at - b.line.at))
      .slice(0, body.size)
      .map(({ line, id }) => ({
        _index: "logs-shop",
        _id: id,
        _source: { "@timestamp": nanoStamp(line.at), message: line.text, service: line.service },
        sort: [nanoStamp(line.at)],
      }));
    return json({ took: 1, timed_out: false, hits: { hits } });
  });
}

/** One multiplexed frame: stream 1 (stdout), three zero bytes, the payload length big-endian. */
function frame(payload: string): Buffer {
  const data = Buffer.from(payload);
  const header = Buffer.alloc(8);
  header[0] = 1;
  header.writeUInt32BE(data.length, 4);
  return Buffer.concat([header, data]);
}

/** Docker's `since` and `until`: seconds with nine decimals. */
const secondsOf = (raw: string | null, fallback: number): number =>
  raw === null ? fallback : Number(raw) * 1000;

function containerLogs(lines: FakeLine[], url: URL): Buffer {
  const since = secondsOf(url.searchParams.get("since"), -Infinity);
  const until = secondsOf(url.searchParams.get("until"), Infinity);
  const tail = url.searchParams.get("tail") ?? "all";
  const kept = lines
    .filter((line) => line.at >= since && line.at <= until)
    .sort((a, b) => a.at - b.at);
  const last = tail === "all" ? kept : kept.slice(-Number(tail));
  return Buffer.concat(last.map((line) => frame(`${nanoStamp(line.at)} ${line.text}\n`)));
}

/**
 * The Docker Engine API behind a read-only socket proxy, over plain HTTP: ping, version, the
 * container list, inspect, and logs as multiplexed frames (no TTY). `service` names the container.
 */
export function fakeDocker(lines: FakeLine[]): Promise<FakeHost> {
  const containers = [...new Set(lines.map((line) => line.service))];
  return serve((url) => {
    if (url.pathname === "/_ping") return { status: 200, type: "text/plain", body: "OK" };
    if (url.pathname === "/version") return json({ ApiVersion: "1.45", Version: "27.0.3" });
    if (url.pathname === "/containers/json")
      return json(containers.map((name) => ({ Names: [`/${name}`] })));
    const [, name = "", what = ""] =
      /^\/containers\/([^/]+)\/(json|logs)$/.exec(url.pathname) ?? [];
    if (!containers.includes(name)) return json({ message: `No such container: ${name}` }, 404);
    if (what === "json")
      return json({ Config: { Tty: false }, HostConfig: { LogConfig: { Type: "json-file" } } });
    const own = lines.filter((line) => line.service === name);
    return {
      status: 200,
      type: "application/vnd.docker.multiplexed-stream",
      body: containerLogs(own, url),
    };
  });
}

/** One `journalctl -o json` entry, as `apps/api/test/journal-host.ts` answers it. */
export type JournalEntry = {
  __CURSOR: string;
  __REALTIME_TIMESTAMP: string;
  PRIORITY: string;
  MESSAGE: string;
  _SYSTEMD_UNIT: string;
};

export function journalEntry(cursor: number, line: FakeLine, priority = "6"): JournalEntry {
  return {
    __CURSOR: `s=e2e;i=${cursor}`,
    __REALTIME_TIMESTAMP: String(line.at * 1000),
    PRIORITY: priority,
    MESSAGE: line.text,
    _SYSTEMD_UNIT: line.service,
  };
}

/**
 * A systemd host over SSH: `ssh2` resolves only inside `apps/api`, and Playwright runs under Node,
 * so the server runs there under Bun, as `scripts/e2e-sql.ts` does for the SQL drivers.
 */
export async function fakeJournalHost(
  entries: JournalEntry[],
  login: { user: string; password: string }
): Promise<FakeHost> {
  const child = spawn("bun", ["apps/api/test/journal-host.ts", login.user, login.password], {
    cwd: ROOT,
    stdio: ["pipe", "pipe", "inherit"],
  });
  child.stdin.end(JSON.stringify(entries));
  const said: { port: number } = await new Promise((resolve, reject) => {
    child.once("exit", (code) => reject(new Error(`the journal host exited with ${code}`)));
    child.stdout.once("data", (chunk: Buffer) => resolve(JSON.parse(chunk.toString())));
  });
  return {
    port: said.port,
    close: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once("exit", () => resolve());
        child.kill();
      }),
  };
}
