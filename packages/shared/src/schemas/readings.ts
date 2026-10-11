import * as v from "valibot";

import { engineSchema } from "../enums.ts";
import { idSchema, timestampSchema } from "./common.ts";

/**
 * A resource reading (#38, docs/decisions/2026-10-11-resource-readings.md): one point-in-time
 * reading of host and database resource use across a project. Not a time series.
 */
export const RESOURCE_UNITS = ["count", "bytes", "seconds", "ratio", "load"] as const;
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

export const readingSchema = v.object({
  id: idSchema,
  taken_at: timestampSchema,
  actor: v.object({ kind: v.picklist(["user", "token"]), label: v.string() }),
  adapters: v.array(readingAdapterSchema),
});
export type Reading = v.InferOutput<typeof readingSchema>;
