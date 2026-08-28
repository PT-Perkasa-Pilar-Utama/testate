import * as v from "valibot";

import { checkoutResultSchema } from "../enums.ts";
import { restoreStrategySchema } from "./adapters.ts";
import { actorSchema, idSchema, tableRefSchema, timestampSchema } from "./common.ts";
import { jobErrorSchema } from "./jobs.ts";
import { stateNameSchema } from "./states.ts";

const columnRefSchema = v.object({ table: v.string(), column: v.string() });

export const schemaDriftSchema = v.object({
  changed: v.boolean(),
  tables: v.object({ added: v.array(v.string()), removed: v.array(v.string()) }),
  columns: v.object({
    added: v.array(columnRefSchema),
    removed: v.array(columnRefSchema),
    type_changed: v.array(columnRefSchema),
    nullability_changed: v.array(columnRefSchema),
  }),
});
export type SchemaDrift = v.InferOutput<typeof schemaDriftSchema>;

export const stateRefBodySchema = v.pipe(
  v.object({
    state_id: v.optional(idSchema),
    state_name: v.optional(stateNameSchema),
    force: v.optional(v.boolean(), false),
    adapter_ids: v.optional(v.array(idSchema)),
  }),
  v.check(
    (input) => (input.state_id === undefined) !== (input.state_name === undefined),
    "exactly one of state_id or state_name"
  )
);
export type CheckoutRequest = v.InferOutput<typeof stateRefBodySchema>;

export const checkoutAdapterSchema = v.object({
  adapter_id: idSchema,
  name: v.string(),
  engine: v.string(),
  result: checkoutResultSchema,
  strategy: v.nullable(restoreStrategySchema),
  rows: v.nullable(v.number()),
  duration_ms: v.nullable(v.number()),
  lock_wait_ms: v.nullable(v.number()),
  skipped_tables: v.array(tableRefSchema),
  skipped_columns: v.array(columnRefSchema),
  defaulted_columns: v.array(columnRefSchema),
  error: v.nullable(jobErrorSchema),
});

export const checkoutSchema = v.object({
  id: idSchema,
  state: v.object({ id: idSchema, name: v.string() }),
  job_id: idSchema,
  stash_state_id: v.nullable(idSchema),
  force: v.boolean(),
  purpose: v.picklist(["checkout", "return_to_init"]),
  status: v.picklist(["running", "succeeded", "partial", "failed", "cancelled", "interrupted"]),
  adapters: v.array(checkoutAdapterSchema),
  actor: actorSchema,
  created_at: timestampSchema,
  finished_at: v.nullable(timestampSchema),
});
export type Checkout = v.InferOutput<typeof checkoutSchema>;

export const preflightSchema = v.object({
  state: v.object({ id: idSchema, name: v.string() }),
  stash_will_be_taken: v.boolean(),
  adapters: v.array(
    v.object({
      adapter_id: idSchema,
      name: v.string(),
      engine: v.string(),
      included: v.boolean(),
      removed: v.boolean(),
      drift: v.nullable(schemaDriftSchema),
      strategy: restoreStrategySchema,
      atomic: v.boolean(),
      locking_notice: v.string(),
      force_preview: v.optional(
        v.object({
          skipped_tables: v.array(tableRefSchema),
          skipped_columns: v.array(columnRefSchema),
          defaulted_columns: v.array(columnRefSchema),
        })
      ),
    })
  ),
});
export type Preflight = v.InferOutput<typeof preflightSchema>;

export const terminateBlockersSchema = v.object({
  adapter_id: idSchema,
  session_ids: v.pipe(v.array(v.string()), v.minLength(1)),
});

export const countersSchema = v.object({
  adapters: v.array(
    v.object({
      adapter_id: idSchema,
      counters: v.array(
        v.object({ name: v.string(), ok: v.boolean(), error: v.optional(v.string()) })
      ),
    })
  ),
});
