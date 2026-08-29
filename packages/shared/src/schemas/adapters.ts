import * as v from "valibot";

import {
  adapterKindSchema,
  adapterModeSchema,
  adapterStatusSchema,
  engineSchema,
  tierSchema,
} from "../enums.ts";
import { engineWarningSchema, idSchema, sealedSchema, timestampSchema } from "./common.ts";
import { jobSchema } from "./jobs.ts";
import { jsonObjectSchema } from "./json.ts";

export const capabilitiesSchema = v.object({
  canTruncate: v.boolean(),
  canDisableTriggers: v.boolean(),
  canTerminateSessions: v.boolean(),
  supportsDeferrableConstraints: v.boolean(),
  transactionalRestore: v.boolean(),
  snapshotRead: v.picklist([
    "repeatable-read",
    "consistent-snapshot",
    "snapshot-read-concern",
    "best-effort",
  ]),
  timeSeriesDeletes: v.boolean(),
});
export type Capabilities = v.InferOutput<typeof capabilitiesSchema>;

export const restoreStrategySchema = v.object({
  emptyMode: v.picklist(["truncate", "delete", "delete-many"]),
  foreignKeyHandling: v.picklist(["session-disable", "dependency-order", "not-applicable"]),
  transactional: v.boolean(),
  triggerDisable: v.boolean(),
  locking: v.picklist(["row", "table", "per-operation"]),
});
export type RestoreStrategy = v.InferOutput<typeof restoreStrategySchema>;

export const readOnlyEnforcementSchema = v.picklist(["transaction", "credential", "filter"]);

export const probeResultSchema = v.object({
  engine: engineSchema,
  dialect: v.picklist(["postgres", "mysql", "mariadb", "mongodb"]),
  version: v.string(),
  meets_floor: v.boolean(),
  floor: v.string(),
  tier: tierSchema,
  capabilities: capabilitiesSchema,
  strategy: restoreStrategySchema,
  read_only_enforcement: readOnlyEnforcementSchema,
  table_count: v.number(),
  size_estimate_bytes: v.number(),
  atomicity_notice: v.string(),
  warnings: v.array(engineWarningSchema),
});
export type ProbeResult = v.InferOutput<typeof probeResultSchema>;

/** The Files tier and REST adapters have no engine to probe; the test reports reachability only. */
export const fileProbeResultSchema = v.object({
  engine: engineSchema,
  tier: tierSchema,
  reachable: v.literal(true),
  warnings: v.array(engineWarningSchema),
});
export type FileProbeResult = v.InferOutput<typeof fileProbeResultSchema>;

export const probeOutcomeSchema = v.union([probeResultSchema, fileProbeResultSchema]);
export type ProbeOutcome = v.InferOutput<typeof probeOutcomeSchema>;

export const adapterSchema = v.object({
  id: idSchema,
  project_id: idSchema,
  kind: adapterKindSchema,
  engine: engineSchema,
  tier: tierSchema,
  name: v.string(),
  mode: adapterModeSchema,
  status: adapterStatusSchema,
  status_message: v.nullable(v.string()),
  config: jsonObjectSchema,
  credential: sealedSchema,
  readonly_credential: sealedSchema,
  excluded_tables: v.array(v.string()),
  restore_mode: v.picklist(["atomic", "fast"]),
  lock_timeout_ms: v.number(),
  engine_version: v.nullable(v.string()),
  dialect: v.nullable(v.string()),
  capabilities: v.nullable(capabilitiesSchema),
  strategy: v.nullable(restoreStrategySchema),
  read_only_enforcement: v.nullable(readOnlyEnforcementSchema),
  last_probe_at: v.nullable(timestampSchema),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export type Adapter = v.InferOutput<typeof adapterSchema>;

const secretValue = v.pipe(v.string(), v.minLength(1), v.maxLength(16384));

export const adapterDraftSchema = v.object({
  kind: adapterKindSchema,
  engine: engineSchema,
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(80)),
  mode: v.optional(adapterModeSchema, "sandbox"),
  config: jsonObjectSchema,
  secrets: v.record(v.string(), secretValue),
  readonly_secrets: v.optional(v.nullable(v.record(v.string(), secretValue))),
  excluded_tables: v.optional(v.array(v.string())),
  restore_mode: v.optional(v.picklist(["atomic", "fast"])),
  lock_timeout_ms: v.optional(
    v.pipe(v.number(), v.integer(), v.minValue(1000), v.maxValue(600000))
  ),
});
export type AdapterDraft = v.InferOutput<typeof adapterDraftSchema>;

export const adapterPatchSchema = v.partial(v.omit(adapterDraftSchema, ["kind", "engine", "mode"]));

export const setModeSchema = v.object({ mode: adapterModeSchema });

export const deletionActionSchema = v.picklist(["restore", "force", "skip"]);

export const adapterDeletionPlanSchema = v.object({
  plan_id: idSchema,
  expires_at: timestampSchema,
  adapter: v.object({
    action: deletionActionSchema,
    reason: v.optional(v.picklist(["read_only", "unreachable", "no_init_state", "removed"])),
    drift: v.nullable(jsonObjectSchema),
  }),
  states_referencing: v.number(),
});

export const adapterDeletionSchema = v.object({
  plan_id: idSchema,
  action: deletionActionSchema,
});
export const createAdapterResponseSchema = v.object({
  adapter: adapterSchema,
  init_job: v.nullable(jobSchema),
});
