/**
 * Loki's answers, parsed at the boundary (#90; L3, L7 of docs/decisions/2026-10-10-loki.md): a log
 * query's streams as lines, a metric query refused, and each refusal Loki gives named with its fix.
 */
import { createHash } from "node:crypto";
import type { JsonObject } from "@testate/shared";
import * as v from "valibot";

import { AppError } from "../../http/index.ts";
import type { LokiAnswer } from "./api.ts";

export type LokiLine = {
  nanos: bigint;
  labels: JsonObject;
  text: string;
  /** The stream's labels and the text: what tells two lines at one nanosecond apart (L5). */
  id: string;
};

const answerSchema = v.object({
  status: v.literal("success"),
  data: v.object({ resultType: v.string(), result: v.array(v.unknown()) }),
});
const streamSchema = v.object({
  stream: v.record(v.string(), v.string()),
  values: v.array(v.tuple([v.pipe(v.string(), v.regex(/^\d{1,20}$/)), v.string()])),
});

const idOf = (labels: JsonObject, text: string): string =>
  createHash("sha256")
    .update(`${JSON.stringify(Object.entries(labels).sort())}\n${text}`)
    .digest("base64url")
    .slice(0, 22);

/** What Loki said no to, as a refusal a person can act on. */
export function refusalOf(answer: LokiAnswer): AppError {
  const text = answer.body.toString().trim();
  if (answer.status === 401 && /no org id/i.test(text))
    return new AppError("ADAPTER_UNREACHABLE", "Loki runs with tenants: set the adapter's tenant", {
      reason: "tenant",
    });
  if (answer.status === 401 || answer.status === 403)
    return new AppError("ADAPTER_UNREACHABLE", "Loki refused the login", { reason: "login" });
  const limit = /max_entries_limit_per_query \(\d+ > (\d+)\)/.exec(text)?.[1];
  if (answer.status === 400 && limit !== undefined)
    return new AppError(
      "VALIDATION_ERROR",
      `Loki answers at most ${limit} lines a query: ask for fewer`,
      {
        reason: "line_limit",
        max: Number(limit),
      }
    );
  return new AppError(
    "ADAPTER_UNREACHABLE",
    `Loki answered ${answer.status}: ${text.slice(0, 300)}`,
    {
      status: answer.status,
    }
  );
}

/** The lines of a log query's answer, in no order; anything else is refused. */
export function linesOf(answer: LokiAnswer): LokiLine[] {
  if (answer.status !== 200) throw refusalOf(answer);
  if (answer.capped)
    throw new AppError("ADAPTER_UNREACHABLE", "Loki's answer passed 10 MB: ask for fewer lines", {
      reason: "too_large",
    });
  const parsed = v.parse(answerSchema, JSON.parse(answer.body.toString()));
  if (parsed.data.resultType !== "streams")
    throw new AppError("ENGINE_UNSUPPORTED", "that is a metric query: a source reads a log query", {
      reason: "metric_query",
    });
  return parsed.data.result.flatMap((raw) => {
    const stream = v.parse(streamSchema, raw);
    const labels: JsonObject = { ...stream.stream };
    return stream.values.map(([nanos, text]) => ({
      nanos: BigInt(nanos),
      labels,
      text,
      id: idOf(labels, text),
    }));
  });
}
