import * as v from "valibot";

import { timestampSchema } from "./common.ts";
import { jsonValueSchema } from "./json.ts";

export const entrySchema = v.object({
  name: v.string(),
  path: v.string(),
  kind: v.picklist(["file", "directory"]),
  size_bytes: v.nullable(v.number()),
  modified_at: v.nullable(timestampSchema),
});
export type Entry = v.InferOutput<typeof entrySchema>;

export const entriesQuerySchema = v.object({
  path: v.optional(v.string()),
  cursor: v.optional(v.string()),
  limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1000))),
  q: v.optional(v.string()),
});

export const previewPayloadSchema = v.variant("kind", [
  v.object({ kind: v.literal("text"), content: v.string(), truncated: v.boolean() }),
  v.object({ kind: v.literal("json"), content: jsonValueSchema, truncated: v.boolean() }),
  v.object({
    kind: v.literal("csv"),
    columns: v.array(v.string()),
    rows: v.array(v.array(jsonValueSchema)),
    truncated: v.boolean(),
  }),
]);

export type PreviewPayload = v.InferOutput<typeof previewPayloadSchema>;

export const acceptHostKeySchema = v.object({
  fingerprint: v.pipe(v.string(), v.minLength(1)),
});

/** A rename, which is also a move: `to` is a whole path, not just the new name. */
export const renameEntrySchema = v.object({
  path: v.pipe(v.string(), v.minLength(1)),
  to: v.pipe(v.string(), v.minLength(1)),
});

/** A copy: `to` is a whole path, like a rename's, and must be free. */
export const copyEntrySchema = renameEntrySchema;

export const directorySchema = v.object({
  path: v.pipe(v.string(), v.minLength(1)),
});
