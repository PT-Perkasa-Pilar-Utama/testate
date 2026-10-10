import { describe, expect, it } from "bun:test";
import type { EsSource, LogsQuery } from "@testate/shared";
import * as v from "valibot";

import { SEEN_MAX, readEs } from "./read.ts";
import type { EsRead } from "./read.ts";
import { ES_START_MS, fakeDocs, fakeEs, stampAt } from "../../../../test/elasticsearch.ts";
import type { FakeDoc } from "../../../../test/elasticsearch.ts";

// #92, E4 (docs/decisions/2026-10-10-elasticsearch.md): pages on the time field with an inclusive
// range and the documents shown at the boundary stamp, since search_after skips ties; follow forward.
const SHOP: EsSource = {
  name: "shop",
  index: "logs-*",
  query: "",
  time_field: "@timestamp",
  message_field: "message",
  patterns: [],
};
const query = (patch: Partial<LogsQuery> = {}): LogsQuery => ({
  source: "shop",
  limit: 10,
  ...patch,
});
const messages = (read: EsRead): string[] => read.hits.map((hit) => String(hit.source["message"]));
const older = (read: EsRead) => ({ cursor: v.parse(v.string(), read.cursor) });

const tied = (count: number, ms: number): FakeDoc[] =>
  Array.from({ length: count }, (_, n) => ({
    index: "logs-shop",
    id: `tie-${n}`,
    stamp: stampAt(ms),
    source: { message: `tie ${n}` },
  }));

describe("an Elasticsearch source", () => {
  it("pages newest first to the end, one millisecond's documents split across pages shown once each", async () => {
    // Line 16 is the first page's tenth: its millisecond's four documents straddle the boundary.
    const es = fakeEs([...fakeDocs(25), ...tied(3, ES_START_MS + 15_000)]);
    const first = await readEs(es, SHOP, query());
    const second = await readEs(es, SHOP, query(older(first)));
    const third = await readEs(es, SHOP, query(older(second)));
    const all = [first, second, third].flatMap((page) => page.hits);
    expect([all.length, new Set(all.map((hit) => hit.id)).size, third.cursor]).toEqual([
      28,
      28,
      null,
    ]);
    const stamps = all.map((hit) => hit.nanos);
    expect(stamps).toEqual([...stamps].sort((a, b) => Number(b - a)));
  });

  it("follows with only what came after the newest shown, a document at its stamp too", async () => {
    const docs = fakeDocs(5);
    const es = fakeEs(docs);
    const first = await readEs(es, SHOP, query());
    const quiet = await readEs(es, SHOP, query({ after: first.after }));
    docs.push(
      {
        index: "logs-shop",
        id: "late",
        stamp: stampAt(ES_START_MS + 4000),
        source: { message: "same millisecond" },
      },
      {
        index: "logs-shop",
        id: "doc-10",
        stamp: stampAt(ES_START_MS + 9000),
        source: { message: "line 10" },
      }
    );
    const next = await readEs(es, SHOP, query({ after: quiet.after }));
    const again = await readEs(es, SHOP, query({ after: next.after }));
    expect([messages(quiet), messages(next), messages(again)]).toEqual([
      [],
      ["line 10", "same millisecond"],
      [],
    ]);
  });

  it("keeps to a window, its `to` included", async () => {
    const es = fakeEs(fakeDocs(25));
    const window = {
      from: new Date(ES_START_MS + 5000).toISOString(),
      to: new Date(ES_START_MS + 11_000).toISOString(),
    };
    const page = await readEs(es, SHOP, query(window));
    expect([messages(page), page.cursor]).toEqual([
      ["line 12", "line 11", "line 10", "line 9", "line 8", "line 7", "line 6"],
      null,
    ]);
  });

  it("stops with lines, no cursor, when one stamp holds more documents than a cursor carries", async () => {
    const es = fakeEs(tied(SEEN_MAX + 120, ES_START_MS));
    let page = await readEs(es, SHOP, query({ limit: 100 }));
    page = await readEs(es, SHOP, query({ limit: 100, ...older(page) }));
    page = await readEs(es, SHOP, query({ limit: 100, ...older(page) }));
    expect([page.cursor, page.cutBy]).toEqual([null, "lines"]);
  });

  it("asks for the source's query, the time field present, and nothing streamed", async () => {
    const es = fakeEs(fakeDocs(3));
    await readEs(es, { ...SHOP, query: "service.name:api" }, query());
    expect(es.requests[0]).toMatchObject({
      kind: "search",
      index: "logs-*",
      body: {
        size: 10,
        track_total_hits: false,
        sort: [{ "@timestamp": { order: "desc", format: "strict_date_optional_time_nanos" } }],
        query: { bool: { must: [{ query_string: { query: "service.name:api" } }] } },
      },
    });
  });
});

describe("an Elasticsearch refusal", () => {
  it.each([
    [
      { timeField: "ts" },
      {},
      "the index has no field @timestamp to sort by time: set the source's time field",
    ],
    [
      {},
      { query: "status:(" },
      "Elasticsearch could not run the query: Failed to parse query [status:(]",
    ],
    [{ maxWindow: 5 }, {}, "Elasticsearch answers at most 5 documents a query: ask for fewer"],
    [{}, { index: "logs-gone" }, "Elasticsearch: no such index [logs-gone]"],
    [{ status: 401 }, {}, "Elasticsearch refused the login"],
    [{ status: 403 }, {}, "the login may not read that index: it needs the read privilege"],
    [{ status: 429 }, {}, "Elasticsearch is busy (a circuit breaker tripped): ask for fewer lines"],
  ])("%p %p is named", async (options, patch, message) => {
    await expect(
      readEs(fakeEs(fakeDocs(3), options), { ...SHOP, ...patch }, query())
    ).rejects.toThrow(message);
  });

  it("refuses a cursor it did not give out", async () => {
    await expect(readEs(fakeEs([]), SHOP, query({ cursor: "bm90IG91cnM" }))).rejects.toThrow(
      "that cursor was not given out by this server"
    );
  });
});
