import * as v from "valibot";

import { idSchema, timestampSchema } from "./common.ts";
import { jsonObjectSchema, jsonValueSchema } from "./json.ts";

export const createDiffSchema = v.object({
  base_state_id: idSchema,
  target: v.union([v.object({ state_id: idSchema }), v.literal("live")]),
  adapter_ids: v.optional(v.array(idSchema)),
});

export const diffTableSchema = v.object({
  schema: v.nullable(v.string()),
  name: v.string(),
  compare: v.picklist(["primary-key", "row-hash"]),
  added: v.number(),
  removed: v.number(),
  changed: v.number(),
  unchanged: v.boolean(),
  schema_changed: v.nullable(v.array(v.string())),
});

export const diffSchema = v.object({
  id: idSchema,
  status: v.picklist(["running", "ready", "failed"]),
  base: v.object({ id: idSchema, name: v.string() }),
  target: v.union([
    v.object({ id: idSchema, name: v.string() }),
    /** The live snapshot lands when the job starts; null until then. */
    v.object({ live: v.literal(true), snapshot_state_id: v.nullable(idSchema) }),
  ]),
  expires_at: timestampSchema,
  adapters: v.array(
    v.object({
      adapter_id: idSchema,
      name: v.string(),
      compared: v.boolean(),
      tables: v.array(diffTableSchema),
    })
  ),
  created_at: timestampSchema,
});
export type Diff = v.InferOutput<typeof diffSchema>;

export const diffRowSchema = v.object({
  k: v.union([v.array(jsonValueSchema), v.string()]),
  op: v.picklist(["added", "removed", "changed"]),
  before: v.nullable(jsonObjectSchema),
  after: v.nullable(jsonObjectSchema),
  changed_columns: v.optional(v.array(v.string())),
});
export type DiffRow = v.InferOutput<typeof diffRowSchema>;

export const diffRowsQuerySchema = v.object({
  adapter_id: idSchema,
  table: v.string(),
  op: v.optional(v.picklist(["added", "removed", "changed"])),
  cursor: v.optional(v.string()),
  limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(500))),
});
