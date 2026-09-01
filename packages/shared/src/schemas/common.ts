import * as v from "valibot";

import { errorCodeSchema, roleSchema } from "../enums.ts";
import { jsonObjectSchema } from "./json.ts";

export const idSchema = v.pipe(v.string(), v.uuid());
export const timestampSchema = v.pipe(v.string(), v.isoTimestamp());
export const slugSchema = v.pipe(v.string(), v.regex(/^[a-z0-9-]{2,64}$/));

export const cursorQuerySchema = v.object({
  cursor: v.optional(v.string()),
  limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200))),
  order: v.optional(v.picklist(["asc", "desc"])),
});

export const pageSchema = v.object({
  next_cursor: v.nullable(v.string()),
  limit: v.pipe(v.number(), v.integer()),
  /**
   * How many rows match, ignoring the page. Null where the endpoint does not count: an append-only
   * log answers "how many" with a scan of the whole table, and a screen that says "12 of 340" is
   * worth less than a list that stays fast. Null means unknown, never zero.
   */
  total: v.nullable(v.pipe(v.number(), v.integer())),
});
export type Page = v.InferOutput<typeof pageSchema>;

export const actorSchema = v.object({
  kind: v.picklist(["user", "token"]),
  id: idSchema,
  label: v.string(),
  role: roleSchema,
  agent: v.boolean(),
});
export type Actor = v.InferOutput<typeof actorSchema>;

export const sealedSchema = v.variant("set", [
  v.object({ set: v.literal(false) }),
  v.object({ set: v.literal(true), set_at: timestampSchema, key_fingerprint: v.string() }),
]);
export type Sealed = v.InferOutput<typeof sealedSchema>;

export const tableRefSchema = v.object({
  schema: v.nullable(v.string()),
  name: v.string(),
});
export type TableRef = v.InferOutput<typeof tableRefSchema>;

export const engineWarningSchema = v.object({
  code: v.string(),
  table: v.optional(v.string()),
  column: v.optional(v.string()),
  message: v.string(),
});
export type EngineWarning = v.InferOutput<typeof engineWarningSchema>;

export const apiErrorSchema = v.object({
  error: v.object({
    code: errorCodeSchema,
    message: v.string(),
    details: v.optional(jsonObjectSchema),
  }),
});
export type ApiError = v.InferOutput<typeof apiErrorSchema>;

export function envelope<TSchema extends v.GenericSchema>(
  data: TSchema
): v.ObjectSchema<{ data: TSchema }, undefined> {
  return v.object({ data });
}

export function pageEnvelope<TSchema extends v.GenericSchema>(
  item: TSchema
): v.ObjectSchema<{ data: v.ArraySchema<TSchema, undefined>; page: typeof pageSchema }, undefined> {
  return v.object({ data: v.array(item), page: pageSchema });
}
