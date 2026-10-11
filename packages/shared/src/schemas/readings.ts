import * as v from "valibot";

import { engineSchema } from "../enums.ts";
import { idSchema, timestampSchema } from "./common.ts";

/**
 * A resource reading (#38, docs/decisions/2026-10-11-resource-readings.md): one point-in-time
 * reading of host and database resource use across a project. The poller takes one per project
 * on an interval, and the series below draws them over time (#101,
 * docs/decisions/2026-10-11-monitor.md).
 */
export const RESOURCE_UNITS = [
  "count",
  "bytes",
  "seconds",
  "ratio",
  "load",
  "percent",
  "bytes_per_second",
] as const;
export const resourceUnitSchema = v.picklist(RESOURCE_UNITS);
export type ResourceUnit = v.InferOutput<typeof resourceUnitSchema>;

/** `memory_available`, `connections`: snake case, stable across readings so two can compare. */
const resourceKeySchema = v.pipe(v.string(), v.regex(/^[a-z][a-z0-9_]{0,63}$/));

export const resourceValueSchema = v.object({
  key: resourceKeySchema,
  value: v.pipe(v.number(), v.finite()),
  unit: resourceUnitSchema,
});
export type ResourceValue = v.InferOutput<typeof resourceValueSchema>;

/** A value the reading could not get, and why: a grant to add, a file the host lacks, a timeout. */
export const resourceGapSchema = v.object({
  key: resourceKeySchema,
  reason: v.pipe(v.string(), v.maxLength(300)),
});
export type ResourceGap = v.InferOutput<typeof resourceGapSchema>;

/** `host` is the machine behind an SFTP login; `server` is the database server. */
export const readingAdapterSchema = v.object({
  adapter_id: idSchema,
  name: v.string(),
  engine: engineSchema,
  source: v.picklist(["host", "server"]),
  values: v.array(resourceValueSchema),
  unavailable: v.array(resourceGapSchema),
});
export type ReadingAdapter = v.InferOutput<typeof readingAdapterSchema>;

/** `poll` is the monitor's timer; `manual` is a person or a token pressing Sample now. */
export const READING_SOURCES = ["manual", "poll"] as const;
export const readingSourceSchema = v.picklist(READING_SOURCES);
export type ReadingSource = v.InferOutput<typeof readingSourceSchema>;

export const readingSchema = v.object({
  id: idSchema,
  taken_at: timestampSchema,
  source: readingSourceSchema,
  actor: v.object({ kind: v.picklist(["user", "token", "system"]), label: v.string() }),
  adapters: v.array(readingAdapterSchema),
});
export type Reading = v.InferOutput<typeof readingSchema>;

/** One bucket of one value: the lowest, the mean and the highest sample inside it. */
export const seriesPointSchema = v.object({
  t: timestampSchema,
  min: v.number(),
  avg: v.number(),
  max: v.number(),
});
export type SeriesPoint = v.InferOutput<typeof seriesPointSchema>;

export const seriesLineSchema = v.object({
  adapter_id: idSchema,
  name: v.string(),
  source: v.picklist(["host", "server"]),
  key: resourceKeySchema,
  unit: resourceUnitSchema,
  points: v.array(seriesPointSchema),
});
export type SeriesLine = v.InferOutput<typeof seriesLineSchema>;

export const readingSeriesSchema = v.object({
  from: timestampSchema,
  to: timestampSchema,
  step_seconds: v.pipe(v.number(), v.integer(), v.minValue(1)),
  lines: v.array(seriesLineSchema),
});
export type ReadingSeries = v.InferOutput<typeof readingSeriesSchema>;

/** The buckets a request may ask for; the series never holds more points than this per line. */
export const SERIES_MAX_POINTS = 1000;

const isoQuery = v.optional(v.array(v.pipe(v.string(), v.isoTimestamp())));

export const readingSeriesQuerySchema = v.object({
  from: isoQuery,
  to: isoQuery,
  step: v.optional(
    v.array(v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1), v.maxValue(86_400)))
  ),
});
