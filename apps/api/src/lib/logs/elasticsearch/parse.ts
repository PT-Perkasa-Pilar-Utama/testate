/**
 * Elasticsearch's answers, parsed at the boundary (#92; E4, E6 of
 * docs/decisions/2026-10-10-elasticsearch.md): a search's hits, and each refusal named with its fix.
 */
import { createHash } from "node:crypto";
import { jsonObjectSchema } from "@testate/shared";
import type { JsonObject } from "@testate/shared";
import * as v from "valibot";

import { AppError } from "../../http/index.ts";
import { nanosOf } from "../time.ts";
import type { HttpAnswer } from "../http.ts";

export type EsHit = {
  index: string;
  /** A short hash of `_index` and `_id`: what tells two documents at one stamp apart (E4). */
  id: string;
  /** The time field's value as the sort gave it, RFC 3339 with nanoseconds. */
  stamp: string;
  nanos: bigint;
  source: JsonObject;
};

const errorSchema = v.object({
  error: v.object({
    type: v.optional(v.string(), ""),
    reason: v.optional(v.nullable(v.string()), ""),
    root_cause: v.optional(
      v.array(
        v.object({
          type: v.optional(v.string(), ""),
          reason: v.optional(v.nullable(v.string()), ""),
        })
      ),
      []
    ),
  }),
});
const hitsSchema = v.object({
  hits: v.object({
    hits: v.array(
      v.object({
        _index: v.string(),
        _id: v.string(),
        _source: v.optional(jsonObjectSchema, {}),
        sort: v.tuple([v.string()]),
      })
    ),
  }),
});

const hashOf = (index: string, id: string): string =>
  createHash("sha256").update(`${index}/${id}`).digest("base64url").slice(0, 12);

/** The most specific reason Elasticsearch gave, or the body itself. */
function reasonOf(text: string): string {
  try {
    const parsed = v.parse(errorSchema, JSON.parse(text));
    return parsed.error.root_cause[0]?.reason ?? parsed.error.reason ?? parsed.error.type;
  } catch {
    return text.slice(0, 300);
  }
}

type Rule = {
  test: (status: number, reason: string) => RegExpExecArray | boolean | null;
  refuse: (match: RegExpExecArray | null, reason: string) => AppError;
};

const RULES: Rule[] = [
  {
    test: (status, reason) =>
      status === 400 && /No mapping found for \[([^\]]+)\] in order to sort on/.exec(reason),
    refuse: (match) =>
      new AppError(
        "VALIDATION_ERROR",
        `the index has no field ${match?.[1] ?? ""} to sort by time: set the source's time field`,
        {
          reason: "time_field",
        }
      ),
  },
  {
    test: (status, reason) => status === 400 && /less than or equal to: \[(\d+)\]/.exec(reason),
    refuse: (match) =>
      new AppError(
        "VALIDATION_ERROR",
        `Elasticsearch answers at most ${match?.[1] ?? ""} documents a query: ask for fewer`,
        {
          reason: "line_limit",
        }
      ),
  },
  {
    test: (status) => status === 400,
    refuse: (_match, reason) =>
      new AppError("VALIDATION_ERROR", `Elasticsearch could not run the query: ${reason}`, {
        reason: "query",
      }),
  },
  {
    test: (status) => status === 401,
    refuse: () =>
      new AppError("ADAPTER_UNREACHABLE", "Elasticsearch refused the login", { reason: "login" }),
  },
  {
    test: (status) => status === 403,
    refuse: () =>
      new AppError(
        "ADAPTER_UNREACHABLE",
        "the login may not read that index: it needs the read privilege",
        {
          reason: "privilege",
        }
      ),
  },
  {
    test: (status) => status === 404,
    refuse: (_match, reason) =>
      new AppError("NOT_FOUND", `Elasticsearch: ${reason}`, { reason: "index" }),
  },
  {
    test: (status) => status === 429,
    refuse: () =>
      new AppError(
        "ADAPTER_UNREACHABLE",
        "Elasticsearch is busy (a circuit breaker tripped): ask for fewer lines",
        {
          reason: "busy",
        }
      ),
  },
];

/** What Elasticsearch said no to, as a refusal a person can act on. */
export function refusalOf(answer: HttpAnswer): AppError {
  const reason = reasonOf(answer.body.toString());
  for (const rule of RULES) {
    const hit = rule.test(answer.status, reason);
    if (hit !== false && hit !== null) return rule.refuse(hit === true ? null : hit, reason);
  }
  return new AppError("ADAPTER_UNREACHABLE", `Elasticsearch answered ${answer.status}: ${reason}`, {
    status: answer.status,
  });
}

/** The hits of a search's answer, in Elasticsearch's order; anything else is refused. */
export function hitsOf(answer: HttpAnswer): EsHit[] {
  if (answer.status !== 200) throw refusalOf(answer);
  if (answer.capped)
    throw new AppError(
      "ADAPTER_UNREACHABLE",
      "Elasticsearch's answer passed 10 MB: ask for fewer lines",
      {
        reason: "too_large",
      }
    );
  const parsed = v.parse(hitsSchema, JSON.parse(answer.body.toString()));
  return parsed.hits.hits.flatMap((hit) => {
    const nanos = nanosOf(hit.sort[0]);
    if (nanos === null) return [];
    return [
      {
        index: hit._index,
        id: hashOf(hit._index, hit._id),
        stamp: hit.sort[0],
        nanos,
        source: hit._source,
      },
    ];
  });
}
