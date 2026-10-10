import type { JsonValue } from "@testate/shared";

import type { LokiAnswer, LokiApi, LokiRequest } from "../src/lib/logs/loki/api.ts";

export type FakeStream = { labels: Map<string, string>; values: [bigint, string][] };

export type FakeLokiOptions = {
  /** A tenant the fake insists on, as a Loki with `auth_enabled`. */
  tenant?: string;
  /** The server's `max_entries_limit_per_query`. */
  maxLimit?: number;
};

const json = (status: number, body: JsonValue): LokiAnswer => ({
  status,
  body: Buffer.from(JSON.stringify(body)),
  capped: false,
});

/** `{a="b", c="d"}`: exact label matches only; enough for the tests' selectors. */
function matches(query: string, labels: Map<string, string>): boolean {
  const selector = /^\{([^}]*)\}/.exec(query)?.[1] ?? "";
  return [...selector.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)].every(
    ([, key = "", value]) => labels.get(key) === value
  );
}

type Entry = { stream: number; nanos: bigint; text: string };

/**
 * A Loki that answers `labels` and `query_range` as measured on 3.4.2 (L5): `start` inclusive,
 * `end` exclusive, `limit` lines from the `direction` end. Lines at one nanosecond come back in a
 * different order on every call, as Loki makes no promise about them.
 */
export function fakeLoki(
  streams: FakeStream[],
  options: FakeLokiOptions = {},
  tenant?: string
): LokiApi & { requests: LokiRequest[] } {
  const requests: LokiRequest[] = [];
  let calls = 0;
  return {
    requests,
    async get(request) {
      requests.push(request);
      calls += 1;
      if (options.tenant !== undefined && tenant !== options.tenant)
        return tenant === undefined
          ? { status: 401, body: Buffer.from("no org id\n"), capped: false }
          : json(200, { status: "success", data: { resultType: "streams", result: [] } });
      if (request.kind === "labels")
        return json(200, {
          status: "success",
          data: [...new Set(streams.flatMap((s) => [...s.labels.keys()]))],
        });
      if (!request.query.startsWith("{"))
        return json(200, { status: "success", data: { resultType: "matrix", result: [] } });
      const max = options.maxLimit ?? 5000;
      if (request.limit > max)
        return {
          status: 400,
          body: Buffer.from(
            `max entries limit per query exceeded, limit > max_entries_limit_per_query (${request.limit} > ${max})`
          ),
          capped: false,
        };
      const end = request.end;
      const entries: Entry[] = streams.flatMap((stream, index) =>
        matches(request.query, stream.labels)
          ? stream.values
              .filter(([nanos]) => nanos >= request.start && (end === undefined || nanos < end))
              .map(([nanos, text]) => ({ stream: index, nanos, text }))
          : []
      );
      const backward = request.direction === "backward";
      // Ties rotate with the call count: no order at one nanosecond holds from one call to the next.
      const tie = (a: Entry, b: Entry): number =>
        ((a.stream + a.text.length + calls) % 3) - ((b.stream + b.text.length + calls) % 3);
      const byTime = (a: Entry, b: Entry): number => (a.nanos < b.nanos === backward ? 1 : -1);
      entries.sort((a, b) => (a.nanos === b.nanos ? tie(a, b) : byTime(a, b)));
      const kept = entries.slice(0, request.limit);
      const result = streams.flatMap((stream, index) => {
        const values = kept
          .filter((entry) => entry.stream === index)
          .map((entry) => [String(entry.nanos), entry.text]);
        return values.length === 0 ? [] : [{ stream: Object.fromEntries(stream.labels), values }];
      });
      return json(200, { status: "success", data: { resultType: "streams", result } });
    },
  };
}

/** Where `fakeLokiLines` starts: 2026-10-10T13:46:40Z. */
export const LOKI_START = 1_791_640_000_000_000_000n;

/** `count` lines a second apart from `start`: `[nanos, "line 1"]` and on. */
export function fakeLokiLines(count: number, start = LOKI_START): [bigint, string][] {
  return Array.from({ length: count }, (_, n) => [
    start + BigInt(n) * 1_000_000_000n,
    `line ${n + 1}`,
  ]);
}
