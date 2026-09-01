import type { Actor, Checkout } from "@testate/shared";
import {
  checkoutResultSchema,
  jobErrorSchema,
  restoreStrategySchema,
  roleSchema,
  tableRefSchema,
} from "@testate/shared";
import * as v from "valibot";

import { FROM } from "./checkouts.query.ts";

const columnRef = v.object({ table: v.string(), column: v.string() });

export const checkoutRow = v.object({
  id: v.string(),
  state_id: v.string(),
  state_name: v.nullable(v.string()),
  job_id: v.string(),
  stash_state_id: v.nullable(v.string()),
  force: v.number(),
  purpose: v.picklist(["checkout", "return_to_init"]),
  status: v.picklist(["running", "succeeded", "partial", "failed", "cancelled", "interrupted"]),
  actor_user_id: v.nullable(v.string()),
  actor_token_id: v.nullable(v.string()),
  created_at: v.string(),
  finished_at: v.nullable(v.string()),
  user_name: v.nullable(v.string()),
  user_role: v.nullable(roleSchema),
  token_name: v.nullable(v.string()),
  token_role: v.nullable(roleSchema),
  token_kind: v.nullable(v.string()),
});

export const adapterRow = v.object({
  checkout_id: v.string(),
  adapter_id: v.string(),
  name: v.nullable(v.string()),
  engine: v.nullable(v.string()),
  result: checkoutResultSchema,
  strategy: v.nullable(v.string()),
  rows: v.nullable(v.number()),
  duration_ms: v.nullable(v.number()),
  lock_wait_ms: v.nullable(v.number()),
  skipped_tables: v.string(),
  skipped_columns: v.string(),
  defaulted_columns: v.string(),
  counters: v.string(),
  error: v.nullable(v.string()),
});

export const SELECT = `
  SELECT c.*, s.name AS state_name, u.username AS user_name, u.role AS user_role,
         t.name AS token_name, t.role AS token_role, t.kind AS token_kind
  ${FROM}`;

/** Adapter name and engine come from the live row, else from the state's manifest once the adapter is gone. */
export const ADAPTERS = `
  SELECT ca.*, COALESCE(a.name, sa.adapter_name) AS name, COALESCE(a.engine, sa.engine) AS engine
  FROM checkout_adapters ca
  JOIN checkouts c ON c.id = ca.checkout_id
  LEFT JOIN adapters a ON a.id = ca.adapter_id
  LEFT JOIN state_adapters sa ON sa.state_id = c.state_id AND sa.adapter_id = ca.adapter_id`;

function actorOf(row: v.InferOutput<typeof checkoutRow>): Actor {
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

function toAdapter(row: v.InferOutput<typeof adapterRow>): Checkout["adapters"][number] {
  return {
    adapter_id: row.adapter_id,
    name: row.name ?? "removed adapter",
    engine: row.engine ?? "unknown",
    result: row.result,
    strategy:
      row.strategy === null ? null : v.parse(restoreStrategySchema, JSON.parse(row.strategy)),
    rows: row.rows,
    duration_ms: row.duration_ms,
    lock_wait_ms: row.lock_wait_ms,
    skipped_tables: v.parse(v.array(tableRefSchema), JSON.parse(row.skipped_tables)),
    skipped_columns: v.parse(v.array(columnRef), JSON.parse(row.skipped_columns)),
    defaulted_columns: v.parse(v.array(columnRef), JSON.parse(row.defaulted_columns)),
    error: row.error === null ? null : v.parse(jobErrorSchema, JSON.parse(row.error)),
  };
}

export function toCheckout(
  row: v.InferOutput<typeof checkoutRow>,
  adapters: v.InferOutput<typeof adapterRow>[]
): Checkout {
  return {
    id: row.id,
    state: { id: row.state_id, name: row.state_name ?? "deleted state" },
    job_id: row.job_id,
    stash_state_id: row.stash_state_id,
    force: row.force === 1,
    purpose: row.purpose,
    status: row.status,
    adapters: adapters.map(toAdapter),
    actor: actorOf(row),
    created_at: row.created_at,
    finished_at: row.finished_at,
  };
}
