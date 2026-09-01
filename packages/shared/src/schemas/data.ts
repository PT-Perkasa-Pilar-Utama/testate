import * as v from "valibot";

import { tierSchema } from "../enums.ts";
import { engineWarningSchema, idSchema, tableRefSchema, timestampSchema } from "./common.ts";
import { jsonObjectSchema, jsonValueSchema } from "./json.ts";

export const maskSchema = v.picklist(["redact", "partial", "hash"]);

export const functionNameSchema = v.picklist([
  "now",
  "uuid_v4",
  "uuid_v7",
  "random_hex",
  "random_base64",
  "hash_bcrypt",
  "hash_argon2id",
  "hash_sha256",
  "hash_sha512",
  "hmac_sha256",
]);

export const requiredFunctionSchema = v.object({
  name: functionNameSchema,
  params: v.optional(jsonObjectSchema),
});

export const columnPolicyRefSchema = v.object({
  required_function: v.nullable(requiredFunctionSchema),
  mask: v.nullable(maskSchema),
});

export const columnSchemaSchema = v.object({
  name: v.string(),
  type: v.string(),
  nullable: v.boolean(),
  has_default: v.boolean(),
  generated: v.boolean(),
  identity: v.boolean(),
  policy: columnPolicyRefSchema,
});

export const foreignKeyOutSchema = v.object({
  columns: v.array(v.string()),
  ref: tableRefSchema,
  ref_columns: v.array(v.string()),
  deferrable: v.boolean(),
});

export const foreignKeyInSchema = v.object({
  from: tableRefSchema,
  columns: v.array(v.string()),
});

export const tableSchemaSchema = v.object({
  schema: v.nullable(v.string()),
  name: v.string(),
  kind: v.picklist(["table", "partition-parent", "inheritance-child"]),
  row_estimate: v.number(),
  columns: v.array(columnSchemaSchema),
  primary_key: v.nullable(v.array(v.string())),
  foreign_keys_out: v.array(foreignKeyOutSchema),
  foreign_keys_in: v.array(foreignKeyInSchema),
  unique: v.array(v.array(v.string())),
  unsupported: v.array(v.object({ column: v.string(), reason: v.string() })),
  excluded: v.boolean(),
  display_column: v.nullable(v.string()),
});
export type TableSchema = v.InferOutput<typeof tableSchemaSchema>;

export const introspectionSchema = v.object({
  tier: tierSchema,
  fingerprint: v.string(),
  tables: v.array(tableSchemaSchema),
  views: v.array(tableRefSchema),
  warnings: v.array(engineWarningSchema),
});
export type Introspection = v.InferOutput<typeof introspectionSchema>;

export const rowsQuerySchema = v.object({
  cursor: v.optional(v.string()),
  limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(500))),
  sort: v.optional(v.string()),
  order: v.optional(v.picklist(["asc", "desc"])),
  filter: v.optional(v.array(v.string())),
});

export const rowsPageSchema = v.object({
  data: v.array(jsonObjectSchema),
  page: v.object({
    next_cursor: v.nullable(v.string()),
    limit: v.number(),
    kind: v.picklist(["keyset", "offset"]),
  }),
  columns: v.array(v.object({ name: v.string(), type: v.string() })),
  masked_columns: v.array(v.string()),
});
export type RowsPage = v.InferOutput<typeof rowsPageSchema>;

export const lookupResultSchema = v.object({
  key: v.array(jsonValueSchema),
  display: v.string(),
});

export const writeSessionSchema = v.object({
  id: idSchema,
  adapter_id: idSchema,
  started_at: timestampSchema,
  foreign_key_checks: v.boolean(),
  fk_checks_mapping: v.string(),
  stash_state_id: v.nullable(idSchema),
  expires_at: timestampSchema,
});
export type WriteSession = v.InferOutput<typeof writeSessionSchema>;

export const formValueSchema = v.variant("kind", [
  v.object({ kind: v.literal("value"), value: jsonValueSchema }),
  v.object({ kind: v.literal("null") }),
  v.object({ kind: v.literal("default") }),
  v.object({
    kind: v.literal("function"),
    name: functionNameSchema,
    input: v.optional(v.string()),
    params: v.optional(jsonObjectSchema),
  }),
]);

export const rowEditSchema = v.variant("kind", [
  v.object({ kind: v.literal("insert"), values: v.record(v.string(), formValueSchema) }),
  v.object({
    kind: v.literal("update"),
    pk: jsonObjectSchema,
    // An update with nothing to set builds `UPDATE t SET  WHERE ...`, which every engine answers
    // with a syntax error. It is refused here, once, rather than in each engine's SQL builder.
    values: v.pipe(
      v.record(v.string(), formValueSchema),
      v.check((values) => Object.keys(values).length > 0, "an update needs at least one column")
    ),
  }),
  v.object({ kind: v.literal("delete"), pk: jsonObjectSchema }),
]);

export const rowEditsSchema = v.object({
  write_session_id: idSchema,
  edits: v.pipe(v.array(rowEditSchema), v.minLength(1), v.maxLength(50)),
});

export const rowEditsResultSchema = v.object({
  results: v.array(
    v.object({
      index: v.number(),
      kind: v.picklist(["insert", "update", "delete"]),
      pk: jsonObjectSchema,
      row: v.nullable(jsonObjectSchema),
    })
  ),
  stash_state_id: v.nullable(idSchema),
});

export const mongoOperationSchema = v.object({
  op: v.picklist(["find", "aggregate"]),
  collection: v.pipe(v.string(), v.minLength(1)),
  filter: v.optional(jsonObjectSchema),
  projection: v.optional(jsonObjectSchema),
  sort: v.optional(jsonObjectSchema),
  limit: v.optional(v.number()),
  skip: v.optional(v.number()),
  pipeline: v.optional(v.array(jsonObjectSchema)),
});

export const queryRequestSchema = v.object({
  dialect: v.picklist(["sql", "mongo"]),
  text: v.optional(v.pipe(v.string(), v.maxLength(262144))),
  params: v.optional(v.array(jsonValueSchema)),
  mongo: v.optional(mongoOperationSchema),
  mode: v.optional(v.picklist(["read", "write"]), "read"),
  write_session_id: v.optional(idSchema),
  row_cap: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(5000))),
  byte_budget: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1024))),
  time_budget_ms: v.optional(v.pipe(v.number(), v.integer(), v.minValue(100), v.maxValue(300000))),
  tag: v.optional(v.pipe(v.string(), v.maxLength(80))),
});
export type QueryRequest = v.InferOutput<typeof queryRequestSchema>;

export const queryResultSchema = v.object({
  query_id: idSchema,
  columns: v.array(v.object({ name: v.string(), type: v.string() })),
  rows: v.array(jsonObjectSchema),
  rows_affected: v.nullable(v.number()),
  truncated: v.object({ rows: v.boolean(), bytes: v.boolean(), time: v.boolean() }),
  duration_ms: v.number(),
  read_only_enforcement: v.picklist(["transaction", "credential", "filter"]),
  masked_columns: v.array(v.string()),
});
export type QueryResult = v.InferOutput<typeof queryResultSchema>;

export const runningQuerySchema = v.object({
  query_id: idSchema,
  tag: v.nullable(v.string()),
  actor: v.string(),
  mode: v.picklist(["read", "write"]),
  started_at: timestampSchema,
  duration_ms: v.number(),
});

export const savedQuerySchema = v.object({
  id: idSchema,
  adapter_id: idSchema,
  name: v.string(),
  body: jsonObjectSchema,
  created_by: idSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const queryHistoryRowSchema = v.object({
  id: idSchema,
  query_hash: v.string(),
  query_text: v.string(),
  mode: v.picklist(["read", "write"]),
  duration_ms: v.nullable(v.number()),
  row_count: v.nullable(v.number()),
  error: v.nullable(v.string()),
  created_at: timestampSchema,
});

export const columnPolicySchema = v.object({
  table: v.string(),
  column: v.string(),
  required_function: v.nullable(requiredFunctionSchema),
  mask: v.nullable(maskSchema),
  display: v.boolean(),
  locked: v.boolean(),
  updated_at: timestampSchema,
});
export type ColumnPolicy = v.InferOutput<typeof columnPolicySchema>;

export const upsertColumnPolicySchema = v.object({
  required_function: v.nullable(requiredFunctionSchema),
  mask: v.nullable(maskSchema),
  display: v.optional(v.boolean(), false),
});

/**
 * The policy dialog (Formisch, see the `formisch-forms` skill): a `<select>` can't carry `null`,
 * so "none" stands in for it here and the presenter maps it back before the PUT.
 */
export const policyFunctionChoiceSchema = v.picklist(["none", ...functionNameSchema.options]);
export const policyMaskChoiceSchema = v.picklist(["none", ...maskSchema.options]);

export const policyFormSchema = v.object({
  fn: policyFunctionChoiceSchema,
  mask: policyMaskChoiceSchema,
  display: v.boolean(),
});
export type PolicyFormInput = v.InferOutput<typeof policyFormSchema>;

export const fixtureRequestSchema = v.object({
  table: v.string(),
  pk: jsonObjectSchema,
  depth: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(3)), 2),
  direction: v.optional(v.picklist(["parents", "children", "both"]), "parents"),
  format: v.optional(v.picklist(["sql", "json"]), "sql"),
});

export const fixtureSchema = v.object({
  format: v.picklist(["sql", "json"]),
  content: v.string(),
  rows: v.number(),
  tables: v.array(v.string()),
  truncated: v.boolean(),
  masked_columns: v.array(v.string()),
});
export type Fixture = v.InferOutput<typeof fixtureSchema>;
