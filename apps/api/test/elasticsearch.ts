import type { JsonObject, JsonValue } from "@testate/shared";
import { jsonObjectSchema } from "@testate/shared";
import * as v from "valibot";

import type { HttpAnswer } from "../src/lib/logs/http.ts";
import type { EsApi, EsRequest } from "../src/lib/logs/elasticsearch/api.ts";
import type { OpenEs } from "../src/modules/adapters/adapters.elasticsearch.api.ts";
import { nanosOf } from "../src/lib/logs/time.ts";

export type FakeDoc = { index: string; id: string; stamp: string; source: JsonObject };

export type FakeEsOptions = {
  version?: string;
  distribution?: string;
  /** The field every index maps as its time; another sort field answers 400, as on 8.15. */
  timeField?: string;
  maxWindow?: number;
  status?: number;
};

const json = (status: number, body: JsonValue): HttpAnswer => ({
  status,
  body: Buffer.from(JSON.stringify(body)),
  capped: false,
});

const error = (status: number, type: string, reason: string): HttpAnswer =>
  json(status, { error: { root_cause: [{ type, reason }], type, reason }, status });

function indexMatches(pattern: string, index: string): boolean {
  return pattern
    .split(",")
    .some((part) =>
      new RegExp(`^${part.replaceAll(".", "\\.").replaceAll("*", ".*")}$`).test(index)
    );
}

const searchSchema = v.object({
  size: v.number(),
  sort: v.tuple([v.record(v.string(), v.object({ order: v.picklist(["asc", "desc"]) }))]),
  query: v.object({
    bool: v.object({
      filter: v.array(jsonObjectSchema),
      must: v.array(v.object({ query_string: v.object({ query: v.string() }) })),
    }),
  }),
});

const rangeSchema = v.object({
  range: v.record(
    v.string(),
    v.object({ gte: v.optional(v.string()), lte: v.optional(v.string()) })
  ),
});

/** `field:value` exact, anything else a substring of the message; `(` unbalanced is a parse error. */
function queryMatches(query: string, doc: FakeDoc): boolean {
  const [field, value] = query.split(":");
  if (value === undefined) return JSON.stringify(doc.source).includes(query);
  return String(doc.source[field ?? ""]) === value;
}

type Search = v.InferOutput<typeof searchSchema>;
type Asked = { field: string; order: "asc" | "desc"; query: string | undefined; body: Search };

function askedOf(request: Extract<EsRequest, { kind: "search" }>): Asked {
  const body = v.parse(searchSchema, request.body);
  const [field, { order }] = Object.entries(body.sort[0])[0] ?? ["", { order: "desc" as const }];
  return { field, order, query: body.query.bool.must[0]?.query_string.query, body };
}

/** The 400s and the 404 Elasticsearch answers before it searches, as measured. */
function refusalFor(
  asked: Asked,
  index: string,
  matching: FakeDoc[],
  options: FakeEsOptions
): HttpAnswer | null {
  const max = options.maxWindow ?? 10000;
  if (asked.field !== (options.timeField ?? "@timestamp"))
    return error(
      400,
      "query_shard_exception",
      `No mapping found for [${asked.field}] in order to sort on`
    );
  if (asked.body.size > max)
    return error(
      400,
      "illegal_argument_exception",
      `Result window is too large, from + size must be less than or equal to: [${max}] but was [${asked.body.size}].`
    );
  if (asked.query?.includes("(") === true && !asked.query.includes(")"))
    return error(400, "query_shard_exception", `Failed to parse query [${asked.query}]`);
  if (matching.length === 0 && !index.includes("*"))
    return error(404, "index_not_found_exception", `no such index [${index}]`);
  return null;
}

function inRange(asked: Asked, docs: FakeDoc[]): FakeDoc[] {
  const range =
    asked.body.query.bool.filter
      .map((item) => v.safeParse(rangeSchema, item))
      .find((item) => item.success)?.output.range[asked.field] ?? {};
  const gte = range.gte === undefined ? null : nanosOf(range.gte);
  const lte = range.lte === undefined ? null : nanosOf(range.lte);
  return docs.filter((doc) => {
    const nanos = nanosOf(doc.stamp) ?? 0n;
    const query = asked.query;
    return (
      (gte === null || nanos >= gte) &&
      (lte === null || nanos <= lte) &&
      (query === undefined || queryMatches(query, doc))
    );
  });
}

/** Ties rotate with the call count: no order at one stamp holds from one call to the next. */
function sorted(docs: FakeDoc[], order: "asc" | "desc", calls: number): FakeDoc[] {
  const rank = (doc: FakeDoc): number =>
    (doc.id.length + doc.id.charCodeAt(doc.id.length - 1) + calls) % 3;
  const byTime = (a: FakeDoc, b: FakeDoc): number =>
    (nanosOf(a.stamp) ?? 0n) < (nanosOf(b.stamp) ?? 0n) === (order === "desc") ? 1 : -1;
  return [...docs].sort((a, b) => (a.stamp === b.stamp ? rank(a) - rank(b) : byTime(a, b)));
}

/**
 * An Elasticsearch that answers `GET /` and `_search` as measured on 8.15.3 (E4): an inclusive
 * range, a sort on the time field, `size` documents. Documents at one stamp come back in a
 * different order on every call, as Elasticsearch promises none.
 */
export function fakeEs(
  docs: FakeDoc[],
  options: FakeEsOptions = {}
): EsApi & { requests: EsRequest[] } {
  const requests: EsRequest[] = [];
  let calls = 0;
  return {
    requests,
    async get(request) {
      requests.push(request);
      calls += 1;
      if (options.status !== undefined)
        return error(options.status, "security_exception", "missing authentication credentials");
      if (request.kind === "info")
        return json(200, {
          version: {
            number: options.version ?? "8.15.3",
            distribution: options.distribution ?? null,
          },
        });
      const asked = askedOf(request);
      const matching = docs.filter((doc) => indexMatches(request.index, doc.index));
      const refusal = refusalFor(asked, request.index, matching, options);
      if (refusal !== null) return refusal;
      const hits = sorted(inRange(asked, matching), asked.order, calls)
        .slice(0, asked.body.size)
        .map((doc) => ({ _index: doc.index, _id: doc.id, _source: doc.source, sort: [doc.stamp] }));
      return json(200, { hits: { hits } });
    },
  };
}
/** Where `fakeDocs` starts: 2026-10-10T13:46:40Z. */
export const ES_START_MS = 1_791_640_000_000;

/** Docker's fixed nine-digit stamp for a millisecond. */
export const stampAt = (ms: number): string => `${new Date(ms).toISOString().slice(0, 23)}000000Z`;

/** `count` documents a second apart in `index`: messages `line 1` and on. */
export function fakeDocs(count: number, index = "logs-shop", start = ES_START_MS): FakeDoc[] {
  return Array.from({ length: count }, (_, n) => ({
    index,
    id: `doc-${n + 1}`,
    stamp: stampAt(start + n * 1000),
    source: { "@timestamp": stampAt(start + n * 1000), message: `line ${n + 1}` },
  }));
}

/** The harness's clusters by host name. */
export function memoryOpenEs(hosts: Map<string, FakeDoc[]>, options: FakeEsOptions = {}): OpenEs {
  return (connection) => fakeEs(hosts.get(new URL(connection.url).hostname) ?? [], options);
}
