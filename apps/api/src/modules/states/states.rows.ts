import type { State, StateAdapter, StateDetail } from "@testate/shared";
import {
  engineWarningSchema,
  manifestTableSchema,
  roleSchema,
  stateKindSchema,
  stateStatusSchema,
} from "@testate/shared";
import * as v from "valibot";

/** One `states` row joined with its actor (users or api_tokens); adapters come from a second query. */
export const stateRowSchema = v.object({
  id: v.string(),
  project_id: v.string(),
  name: v.string(),
  kind: stateKindSchema,
  status: stateStatusSchema,
  protected: v.number(),
  notes: v.nullable(v.string()),
  tags: v.string(),
  parent_state_id: v.nullable(v.string()),
  stash_reason: v.nullable(v.picklist(["checkout", "import", "write-session"])),
  job_id: v.string(),
  actor_user_id: v.nullable(v.string()),
  actor_token_id: v.nullable(v.string()),
  size_bytes: v.number(),
  created_at: v.string(),
  updated_at: v.string(),
  user_name: v.nullable(v.string()),
  user_role: v.nullable(roleSchema),
  token_name: v.nullable(v.string()),
  token_role: v.nullable(roleSchema),
  token_kind: v.nullable(v.string()),
});
export type StateRow = v.InferOutput<typeof stateRowSchema>;

export const adapterRowSchema = v.object({
  state_id: v.string(),
  adapter_id: v.string(),
  adapter_name: v.string(),
  engine: v.string(),
  engine_version: v.string(),
  fingerprint: v.string(),
  consistency: v.picklist(["snapshot", "best_effort"]),
  removed: v.number(),
  tables: v.string(),
  row_count: v.number(),
  byte_count: v.number(),
  warnings: v.string(),
});
export type AdapterRow = v.InferOutput<typeof adapterRowSchema>;

/** The joined query behind every read; `s.*` first so the actor columns never shadow a state column. */
export const STATE_SELECT = `
  SELECT s.*, u.username AS user_name, u.role AS user_role,
         t.name AS token_name, t.role AS token_role, t.kind AS token_kind
  FROM states s
  LEFT JOIN users u ON u.id = s.actor_user_id
  LEFT JOIN api_tokens t ON t.id = s.actor_token_id`;

function actorOf(row: StateRow): State["actor"] {
  if (row.actor_token_id !== null) {
    return {
      kind: "token",
      id: row.actor_token_id,
      label: row.token_name ?? "removed token",
      role: row.token_role ?? "viewer",
      agent: row.token_kind === "agent",
    };
  }
  return {
    kind: "user",
    id: row.actor_user_id ?? "",
    label: row.user_name ?? "removed user",
    role: row.user_role ?? "viewer",
    agent: false,
  };
}

export function toStateAdapter(row: AdapterRow): StateAdapter {
  return {
    adapter_id: row.adapter_id,
    adapter_name: row.adapter_name,
    engine: row.engine,
    engine_version: row.engine_version,
    fingerprint: row.fingerprint,
    consistency: row.consistency,
    removed: row.removed === 1,
    row_count: row.row_count,
    byte_count: row.byte_count,
    warnings: v.parse(v.array(engineWarningSchema), JSON.parse(row.warnings)),
  };
}

export function toState(row: StateRow, adapters: AdapterRow[]): State {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    status: row.status,
    protected: row.protected === 1,
    notes: row.notes,
    tags: v.parse(v.array(v.string()), JSON.parse(row.tags)),
    parent_state_id: row.parent_state_id,
    stash_reason: row.stash_reason,
    adapters: adapters.map(toStateAdapter),
    size_bytes: row.size_bytes,
    actor: actorOf(row),
    job_id: row.job_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function toStateDetail(row: StateRow, adapters: AdapterRow[]): StateDetail {
  return {
    ...toState(row, adapters),
    adapters: adapters.map((adapter) => ({
      ...toStateAdapter(adapter),
      tables: v.parse(v.array(manifestTableSchema), JSON.parse(adapter.tables)),
    })),
  };
}
