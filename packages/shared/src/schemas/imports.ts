import * as v from "valibot";

import { actorSchema, idSchema, timestampSchema } from "./common.ts";
import { jsonObjectSchema, jsonValueSchema } from "./json.ts";

export const uploadSchema = v.object({
  upload_id: idSchema,
  file_name: v.string(),
  size_bytes: v.number(),
  type: v.picklist(["csv", "xlsx", "tar"]),
  expires_at: timestampSchema,
});
export type Upload = v.InferOutput<typeof uploadSchema>;

export const importSourceSchema = v.union([
  v.object({ upload_id: idSchema }),
  v.object({ adapter_id: idSchema, path: v.string() }),
  v.object({ rejected_of_run_id: idSchema }),
]);

export const parseOptionsSchema = v.object({
  sheet: v.optional(v.string()),
  header_row: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
  delimiter: v.optional(v.picklist([",", ";", "\t", "|"])),
  encoding: v.optional(v.string()),
});

export const previewRequestSchema = v.object({
  source: importSourceSchema,
  options: v.optional(parseOptionsSchema),
});

export const previewSchema = v.object({
  columns: v.array(v.string()),
  rows: v.array(v.array(jsonValueSchema)),
  sheets: v.optional(v.array(v.string())),
  detected: v.object({
    delimiter: v.optional(v.string()),
    encoding: v.string(),
    header_row: v.number(),
  }),
  typed_cells: v.boolean(),
});
export type Preview = v.InferOutput<typeof previewSchema>;

export const transformSchema = v.variant("kind", [
  v.object({ kind: v.literal("trim") }),
  v.object({ kind: v.literal("emptyToNull") }),
  v.object({ kind: v.literal("lowercase") }),
  v.object({ kind: v.literal("uppercase") }),
  v.object({ kind: v.literal("number"), locale: v.optional(v.string()) }),
  v.object({ kind: v.literal("date"), format: v.string(), timezone: v.optional(v.string()) }),
  v.object({
    kind: v.literal("boolean"),
    trueValues: v.array(v.string()),
    falseValues: v.array(v.string()),
  }),
  v.object({ kind: v.literal("constant"), value: jsonValueSchema }),
  v.object({ kind: v.literal("uuid") }),
  v.object({ kind: v.literal("now") }),
  v.object({ kind: v.literal("json") }),
  v.object({
    kind: v.literal("hash"),
    algorithm: v.picklist(["bcrypt", "argon2id", "sha256", "sha512", "hmac_sha256"]),
    /** HMAC's key. Kept in the normalizer as it is, so it is not a secret worth much. */
    secret: v.optional(v.string()),
    /** Prepended before a SHA digest; bcrypt and Argon2id salt each value on their own. */
    salt: v.optional(v.string()),
  }),
]);

/** One step of a column's read. The SPA builds these from the shorter question it asks. */
export type Transform = v.InferOutput<typeof transformSchema>;

export const importModeSchema = v.picklist(["append", "upsert", "replace"]);

export const normalizerColumnSchema = v.object({
  source: v.nullable(v.string()),
  target: v.string(),
  transforms: v.array(transformSchema),
});

export const normalizerBodySchema = v.object({
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(80)),
  target: v.string(),
  columns: v.pipe(v.array(normalizerColumnSchema), v.minLength(1)),
  key_columns: v.optional(v.array(v.string()), []),
  mode: v.optional(importModeSchema, "append"),
  options: v.optional(parseOptionsSchema, {}),
});

export const normalizerSchema = v.object({
  ...normalizerBodySchema.entries,
  id: idSchema,
  adapter_id: idSchema,
  created_by: idSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export type Normalizer = v.InferOutput<typeof normalizerSchema>;

export const importRunRequestSchema = v.object({
  adapter_id: idSchema,
  normalizer_id: idSchema,
  source: importSourceSchema,
  mode: v.optional(importModeSchema),
  dry_run: v.optional(v.boolean(), false),
  stash_first: v.optional(v.boolean()),
  foreign_key_checks: v.optional(v.boolean(), true),
  options: v.optional(parseOptionsSchema),
});

export const importReportSchema = v.object({
  run_id: idSchema,
  dry_run: v.boolean(),
  inserted: v.number(),
  updated: v.number(),
  skipped: v.number(),
  failed: v.number(),
  duration_ms: v.number(),
  errors_preview: v.array(v.object({ row_number: v.number(), reason: v.string() })),
  rejected_available: v.boolean(),
  stash_state_id: v.nullable(idSchema),
});
export type ImportReport = v.InferOutput<typeof importReportSchema>;

export const importRunSchema = v.object({
  id: idSchema,
  adapter_id: idSchema,
  normalizer_id: idSchema,
  job_id: idSchema,
  source: jsonObjectSchema,
  dry_run: v.boolean(),
  mode: importModeSchema,
  stash_state_id: v.nullable(idSchema),
  counts: v.nullable(jsonObjectSchema),
  rejected_available: v.boolean(),
  actor: actorSchema,
  created_at: timestampSchema,
  finished_at: v.nullable(timestampSchema),
});
export type ImportRun = v.InferOutput<typeof importRunSchema>;
