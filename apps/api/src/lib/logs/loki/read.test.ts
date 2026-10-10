import { describe, expect, it } from "bun:test";
import type { LokiSource, LogsQuery } from "@testate/shared";
import * as v from "valibot";

import { readLoki } from "./read.ts";
import type { LokiRead } from "./read.ts";
import { LOKI_START, fakeLoki, fakeLokiLines } from "../../../../test/loki.ts";
import type { FakeStream } from "../../../../test/loki.ts";

// #90, L5 (docs/decisions/2026-10-10-loki.md): pages on Loki's stamp with the lines shown at the
// boundary nanosecond, since ties split across pages in no stable order; follow forward.
const SIT: LokiSource = { name: "sit", query: '{env="sit"}', format: "plain", patterns: [] };
const DAY_MS = 24 * 60 * 60 * 1000;
const START_MS = Number(LOKI_START / 1_000_000n);
const soon = () => START_MS + 60_000;

const stream = (labels: [string, string][], values: [bigint, string][]): FakeStream => ({
  labels: new Map(labels),
  values,
});
const query = (patch: Partial<LogsQuery> = {}): LogsQuery => ({
  source: "sit",
  limit: 10,
  ...patch,
});
const texts = (read: LokiRead): string[] => read.lines.map((line) => line.text);
const older = (read: LokiRead) => ({ cursor: v.parse(v.string(), read.cursor) });

describe("a Loki source", () => {
  it("pages newest first to the start, a nanosecond's ties split across pages shown once each", async () => {
    // Line 16 is the first page's tenth: its nanosecond's four lines straddle the boundary.
    const tied = LOKI_START + 15_000_000_000n;
    const loki = fakeLoki([
      stream(
        [
          ["env", "sit"],
          ["service", "api"],
        ],
        fakeLokiLines(25)
      ),
      stream(
        [
          ["env", "sit"],
          ["service", "worker"],
        ],
        [
          [tied, "tie a"],
          [tied, "tie b"],
          [tied, "tie c"],
        ]
      ),
    ]);
    const first = await readLoki(loki, SIT, query(), soon);
    const second = await readLoki(loki, SIT, query(older(first)), soon);
    const third = await readLoki(loki, SIT, query(older(second)), soon);
    const fourth = await readLoki(loki, SIT, query(older(third)), soon);
    const all = [first, second, third].flatMap((page) => page.lines);
    expect([all.length, new Set(all.map((line) => line.id)).size]).toEqual([28, 28]);
    const stamps = all.map((line) => line.nanos);
    expect(stamps).toEqual([...stamps].sort((a, b) => Number(b - a)));
    expect([texts(fourth), fourth.cursor, fourth.cutBy]).toEqual([[], null, "window"]);
  });

  it("searches the 7 days before a short page, across a quiet gap", async () => {
    const later = LOKI_START + BigInt(10 * DAY_MS) * 1_000_000n;
    const loki = fakeLoki([
      stream(
        [["env", "sit"]],
        [
          ...fakeLokiLines(3),
          ...fakeLokiLines(2, later).map(([n, t]): [bigint, string] => [n, `late ${t}`]),
        ]
      ),
    ]);
    const now = () => START_MS + 10 * DAY_MS + 60_000;
    const first = await readLoki(loki, SIT, query(), now);
    const second = await readLoki(loki, SIT, query(older(first)), now);
    expect([texts(first), texts(second)]).toEqual([
      ["late line 2", "late line 1"],
      ["line 3", "line 2", "line 1"],
    ]);
  });

  it("follows with only what came after the newest shown, a line at its nanosecond too", async () => {
    const lines = fakeLokiLines(5);
    const loki = fakeLoki([stream([["env", "sit"]], lines)]);
    const first = await readLoki(loki, SIT, query(), soon);
    const quiet = await readLoki(loki, SIT, query({ after: first.after }), soon);
    lines.push(
      [LOKI_START + 4_000_000_000n, "same nanosecond"],
      [LOKI_START + 9_000_000_000n, "line 10"]
    );
    const next = await readLoki(loki, SIT, query({ after: quiet.after }), soon);
    const again = await readLoki(loki, SIT, query({ after: next.after }), soon);
    expect([texts(quiet), texts(next), texts(again)]).toEqual([
      [],
      ["line 10", "same nanosecond"],
      [],
    ]);
  });

  it("ends a window's page at its `to`, that line included", async () => {
    const loki = fakeLoki([stream([["env", "sit"]], fakeLokiLines(25))]);
    const to = new Date(START_MS + 11_000).toISOString();
    expect(texts(await readLoki(loki, SIT, query({ to, limit: 3 }), soon))).toEqual([
      "line 12",
      "line 11",
      "line 10",
    ]);
  });
});

describe("a Loki refusal", () => {
  const loki = fakeLoki([stream([["env", "sit"]], fakeLokiLines(3))], {
    maxLimit: 100,
    tenant: "shop",
  });

  it("names a metric query", async () => {
    const metric = { ...SIT, query: 'count_over_time({env="sit"}[1m])' };
    await expect(readLoki(fakeLoki([]), metric, query(), soon)).rejects.toMatchObject({
      code: "ENGINE_UNSUPPORTED",
      details: { reason: "metric_query" },
    });
  });

  it("names a missing tenant", async () => {
    await expect(readLoki(loki, SIT, query(), soon)).rejects.toThrow(
      "Loki runs with tenants: set the adapter's tenant"
    );
  });

  it("names the server's own line limit", async () => {
    const strict = fakeLoki([stream([["env", "sit"]], fakeLokiLines(3))], { maxLimit: 100 });
    await expect(readLoki(strict, SIT, query({ limit: 200 }), soon)).rejects.toThrow(
      "Loki answers at most 100 lines a query: ask for fewer"
    );
  });

  it("refuses a cursor it did not give out", async () => {
    await expect(
      readLoki(fakeLoki([]), SIT, query({ cursor: "bm90IG91cnM" }), soon)
    ).rejects.toThrow("that cursor was not given out by this server");
  });
});
