/**
 * One page of an Elasticsearch source (#92; E4 of docs/decisions/2026-10-10-elasticsearch.md), on
 * its time field. `search_after` skips the documents sharing the last time, so a page asks an
 * inclusive range and drops the documents already shown at its mark.
 */
import { LOG_LINE_MAX } from "@testate/shared";
import type { EsSource, JsonObject, LogsQuery } from "@testate/shared";
import * as v from "valibot";

import { AppError } from "../../http/index.ts";
import { READ_CEILING } from "../read.ts";
import type { EsApi } from "./api.ts";
import { hitsOf } from "./parse.ts";
import type { EsHit } from "./parse.ts";

export type EsRead = {
  /** Newest first. */
  hits: EsHit[];
  cursor: string | null;
  after: string;
  cutBy: "lines" | null;
  bytes: number;
};

/** The sort and the range speak RFC 3339 with nanoseconds, for `date` and `date_nanos` alike. */
const NANOS_FORMAT = "strict_date_optional_time_nanos";
/** How many documents at one stamp a cursor carries before it stops (E4). */
export const SEEN_MAX = 200;

const markSchema = v.object({
  stamp: v.pipe(v.string(), v.maxLength(64)),
  seen: v.pipe(v.array(v.pipe(v.string(), v.maxLength(16))), v.maxLength(SEEN_MAX)),
});
type Mark = v.InferOutput<typeof markSchema>;
const tokenSchema = v.object({ older: v.optional(markSchema), newer: v.nullable(markSchema) });
type Token = v.InferOutput<typeof tokenSchema>;

const encode = (token: Token): string => Buffer.from(JSON.stringify(token)).toString("base64url");

function decode(raw: string): Token {
  try {
    return v.parse(tokenSchema, JSON.parse(Buffer.from(raw, "base64url").toString()));
  } catch {
    throw new AppError("VALIDATION_ERROR", "that cursor was not given out by this server");
  }
}

type Bounds = { gte?: string | undefined; lte?: string | undefined };

/** The search body: the source's query, the time field present and in range, sorted on it. */
export function searchBody(
  source: EsSource,
  bounds: Bounds,
  order: "asc" | "desc",
  size: number
): JsonObject {
  const range: JsonObject = { format: NANOS_FORMAT };
  if (bounds.gte !== undefined) range.gte = bounds.gte;
  if (bounds.lte !== undefined) range.lte = bounds.lte;
  const filter: JsonObject[] = [
    { exists: { field: source.time_field } },
    { range: { [source.time_field]: range } },
  ];
  const must: JsonObject[] = source.query === "" ? [] : [{ query_string: { query: source.query } }];
  return {
    size,
    track_total_hits: false,
    sort: [{ [source.time_field]: { order, format: NANOS_FORMAT } }],
    query: { bool: { filter, must } },
  };
}

/** Drops the documents a mark says were shown already. */
function unseen(hits: EsHit[], mark: Mark | undefined): EsHit[] {
  if (mark === undefined) return hits;
  const seen = new Set(mark.seen);
  return hits.filter((hit) => hit.stamp !== mark.stamp || !seen.has(hit.id));
}

/** A mark at `hit`, carrying what was shown at its stamp before; null past SEEN_MAX. */
function markAt(hit: EsHit, page: EsHit[], previous: Mark | undefined): Mark | null {
  const here = page.filter((item) => item.stamp === hit.stamp).map((item) => item.id);
  const before = previous?.stamp === hit.stamp ? previous.seen : [];
  const seen = [...new Set([...before, ...here])];
  return seen.length > SEEN_MAX ? null : { stamp: hit.stamp, seen };
}

type Got = { hits: EsHit[]; bytes: number };

async function search(api: EsApi, source: EsSource, body: JsonObject): Promise<Got> {
  const answer = await api.get({ kind: "search", index: source.index, body }, READ_CEILING);
  return { hits: hitsOf(answer), bytes: answer.body.length };
}

/** Documents stamped at or after the newest shown, those shown dropped, given back newest first. */
async function follow(api: EsApi, source: EsSource, mark: Mark, pageSize: number): Promise<EsRead> {
  const size = Math.min(pageSize + mark.seen.length, LOG_LINE_MAX);
  const got = await search(api, source, searchBody(source, { gte: mark.stamp }, "asc", size));
  const page = unseen(got.hits, mark).slice(0, pageSize);
  const newest = page.at(-1);
  const next = newest === undefined ? null : markAt(newest, page, mark);
  // ponytail: past SEEN_MAX documents at the newest stamp the mark cannot move, so each poll shows
  // that stamp's overflow again, said with `lines`, until a newer stamp arrives. PIT is the upgrade.
  const overflow = newest !== undefined && next === null;
  return {
    hits: page.reverse(),
    cursor: null,
    after: encode({ newer: next ?? mark }),
    cutBy: overflow ? "lines" : null,
    bytes: got.bytes,
  };
}

type Older = { cursor: string | null; cutBy: EsRead["cutBy"] };

/** A full read leaves more; a short one is the end of the index or the window. */
function olderOf(full: boolean, page: EsHit[], mark: Mark | undefined): Older {
  const oldest = page.at(-1);
  if (!full) return { cursor: null, cutBy: null };
  // ponytail: more documents at one stamp than a page or SEEN_MAX holds stall here; a millisecond
  // `date` field from a shipper batch can do it. A page of that stamp alone (`gte` and `lte` equal,
  // paged with search_after on `_shard_doc` inside a PIT) is the upgrade.
  const next = oldest === undefined ? null : markAt(oldest, page, mark);
  if (next === null) return { cursor: null, cutBy: "lines" };
  return { cursor: encode({ older: next, newer: null }), cutBy: "lines" };
}

export async function readEs(api: EsApi, source: EsSource, query: LogsQuery): Promise<EsRead> {
  const after = query.after === undefined ? null : decode(query.after).newer;
  if (after !== null) return follow(api, source, after, query.limit);
  const mark = query.cursor === undefined ? undefined : decode(query.cursor).older;
  const size = Math.min(query.limit + (mark?.seen.length ?? 0), LOG_LINE_MAX);
  const bounds = { gte: query.from, lte: mark?.stamp ?? query.to };
  const got = await search(api, source, searchBody(source, bounds, "desc", size));
  const page = unseen(got.hits, mark).slice(0, query.limit);
  const newest = page[0];
  return {
    hits: page,
    ...olderOf(got.hits.length === size, page, mark),
    after: encode({ newer: newest === undefined ? null : markAt(newest, page, undefined) }),
    bytes: got.bytes,
  };
}
