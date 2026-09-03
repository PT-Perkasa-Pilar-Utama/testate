import type {
  DetailTable,
  ManifestTable,
  State,
  StateAdapter,
  StateDetail,
  TableChange,
} from "@testate/shared";
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
    // ponytail: the column is NOT NULL, so an inline stash stores "", null on the wire; a rebuild migration lifts it.
    job_id: row.job_id === "" ? null : row.job_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function tablesOf(row: AdapterRow): ManifestTable[] {
  return v.parse(v.array(manifestTableSchema), JSON.parse(row.tables));
}

const key = (table: { schema: string | null; name: string }): string =>
  table.schema === null ? table.name : `${table.schema}.${table.name}`;

/** What a state's tables did against its parent's, per adapter. */
export type Compared = { tables: DetailTable[]; removed_tables: string[] };

function changeOf(hash: string | undefined, mine: string): TableChange {
  if (hash === undefined) return "added";
  return hash === mine ? "same" : "changed";
}

/**
 * Each table against the parent's manifest of the same adapter: the same blob hash is the same
 * rows, a different one is a change, no counterpart is an addition. Null across the board when
 * there is no parent; every table added when the parent never held this adapter.
 */
export function changesAgainst(tables: ManifestTable[], parent: ManifestTable[] | null): Compared {
  if (parent === null) {
    return { tables: tables.map((t) => ({ ...t, change: null })), removed_tables: [] };
  }
  const before = new Map(parent.map((table) => [key(table), table.blob_hash]));
  const mine = new Set(tables.map(key));
  return {
    tables: tables.map((table) => ({
      ...table,
      change: changeOf(before.get(key(table)), table.blob_hash),
    })),
    removed_tables: parent.map(key).filter((name) => !mine.has(name)),
  };
}

/** The parent's tables for one adapter: null with no parent, empty when it never held the adapter. */
function parentTables(parent: AdapterRow[] | null, adapterId: string): ManifestTable[] | null {
  if (parent === null) return null;
  const counterpart = parent.find((item) => item.adapter_id === adapterId);
  return counterpart === undefined ? [] : tablesOf(counterpart);
}

export function toStateDetail(
  row: StateRow,
  adapters: AdapterRow[],
  parent: AdapterRow[] | null
): StateDetail {
  return {
    ...toState(row, adapters),
    adapters: adapters.map((adapter) => ({
      ...toStateAdapter(adapter),
      ...changesAgainst(tablesOf(adapter), parentTables(parent, adapter.adapter_id)),
    })),
  };
}
