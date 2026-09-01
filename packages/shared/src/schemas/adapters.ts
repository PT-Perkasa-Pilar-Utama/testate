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

export const restoreModeSchema = v.picklist(["atomic", "fast"]);
const LOCK_TIMEOUT_MIN_MS = 1000;
const LOCK_TIMEOUT_MAX_MS = 600000;

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

/** The Files tier has no engine to probe; the test reports reachability only. */
export const fileProbeResultSchema = v.object({
  engine: engineSchema,
  tier: tierSchema,
  reachable: v.literal(true),
  warnings: v.array(engineWarningSchema),
});
export type FileProbeResult = v.InferOutput<typeof fileProbeResultSchema>;

export const probeOutcomeSchema = v.union([probeResultSchema, fileProbeResultSchema]);
export type ProbeOutcome = v.InferOutput<typeof probeOutcomeSchema>;

/** A host the API can reach from where it runs, offered under the Host field. */
export const hostSuggestionSchema = v.object({ host: v.string(), label: v.string() });
export type HostSuggestion = v.InferOutput<typeof hostSuggestionSchema>;

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
  restore_mode: restoreModeSchema,
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
  name: v.pipe(
    v.string(),
    v.minLength(1, "Name the adapter."),
    v.maxLength(80, "Keep the name to 80 characters.")
  ),
  // No default here on purpose: the service picks one per kind, and the two kinds want opposite
  // answers. A database is a sandbox until someone protects it; a file store is read-only until
  // someone opens it (23 §23.6).
  mode: v.optional(adapterModeSchema),
  config: jsonObjectSchema,
  secrets: v.record(v.string(), secretValue),
  readonly_secrets: v.optional(v.nullable(v.record(v.string(), secretValue))),
  excluded_tables: v.optional(v.array(v.string())),
  restore_mode: v.optional(restoreModeSchema),
  lock_timeout_ms: v.optional(
    v.pipe(
      v.number(),
      v.integer(),
      v.minValue(LOCK_TIMEOUT_MIN_MS, `Lock timeout is at least ${LOCK_TIMEOUT_MIN_MS} ms.`),
      v.maxValue(LOCK_TIMEOUT_MAX_MS, `Lock timeout is at most ${LOCK_TIMEOUT_MAX_MS} ms.`)
    )
  ),
});
export type AdapterDraft = v.InferOutput<typeof adapterDraftSchema>;

export const adapterPatchSchema = v.partial(v.omit(adapterDraftSchema, ["kind", "engine", "mode"]));

/**
 * The Create dialog's static fields: `kind` is derived from the engine, and `config`/`secrets`/
 * `readonly_secrets` are keyed per engine at runtime from `ENGINE_FORMS` (`adapters.fields.ts`).
 * Formisch initializes its whole field tree from the schema up front and throws on a `record`
 * schema (`config`/`secrets` are `v.record`), so those stay outside this schema and are bound to
 * plain signals in `adapters.view.tsx` instead of a `<Field>`.
 */
export const adapterCreateFormSchema = v.object({
  ...v.omit(adapterDraftSchema, [
    "kind",
    "config",
    "secrets",
    "readonly_secrets",
    "excluded_tables",
    "restore_mode",
    "lock_timeout_ms",
    "mode",
  ]).entries,
  // The dialog has a Mode control, so its form always carries an answer; the wire schema leaves
  // the field open because the service picks a different default for each kind.
  mode: v.optional(adapterModeSchema, "sandbox"),
});
export type AdapterCreateFormInput = v.InferOutput<typeof adapterCreateFormSchema>;

/**
 * The Edit dialog's static fields: rename, exclusions, schemas, restore knobs. `excluded_tables`
 * and `schemas` stay comma-separated text here (the same shape `adapter.edit.ts`'s `list()` already
 * turns into an array for the patch body) rather than transforming to `string[]` in the schema, so
 * an untouched draft still round-trips through the existing, already-tested patch-diffing logic.
 * `config`/`secrets`/`readonly_secrets` are the same runtime-keyed fields left out of the create
 * form above, for the same reason.
 */
export const adapterEditFormSchema = v.object({
  name: adapterDraftSchema.entries.name,
  excluded_tables: v.string(),
  schemas: v.string(),
  restore_mode: restoreModeSchema,
  lock_timeout_ms: v.pipe(
    v.string(),
    v.check((raw: string) => {
      const value = Number(raw);
      return (
        Number.isInteger(value) && value >= LOCK_TIMEOUT_MIN_MS && value <= LOCK_TIMEOUT_MAX_MS
      );
    }, `Enter a whole number of milliseconds, from ${LOCK_TIMEOUT_MIN_MS} to ${LOCK_TIMEOUT_MAX_MS}.`)
  ),
});
export type AdapterEditFormInput = v.InferOutput<typeof adapterEditFormSchema>;

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
