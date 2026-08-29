import type { Actor, ImportReport, ImportRun } from "@testate/shared";
import { importModeSchema, roleSchema } from "@testate/shared";
import * as v from "valibot";

export type RunRecord = ImportRun & { project_id: string; rejected_path: string | null };

export const runRow = v.object({
  id: v.string(),
  project_id: v.string(),
  adapter_id: v.string(),
  mapping_id: v.string(),
  job_id: v.string(),
  source_kind: v.picklist(["upload", "storage", "rejected"]),
  source_ref: v.string(),
  dry_run: v.number(),
  mode: importModeSchema,
  stash_state_id: v.nullable(v.string()),
  counts: v.nullable(v.string()),
  rejected_path: v.nullable(v.string()),
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

const countsSchema = v.object({
  inserted: v.number(),
  updated: v.number(),
  skipped: v.number(),
  failed: v.number(),
  duration_ms: v.number(),
});

export const RUN_SELECT = `
  SELECT r.*, u.username AS user_name, u.role AS user_role, t.name AS token_name, t.role AS token_role, t.kind AS token_kind
  FROM import_runs r LEFT JOIN users u ON u.id = r.actor_user_id LEFT JOIN api_tokens t ON t.id = r.actor_token_id`;

function actorOf(row: v.InferOutput<typeof runRow>): Actor {
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

export function toRun(row: v.InferOutput<typeof runRow>): RunRecord {
  return {
    id: row.id,
    project_id: row.project_id,
    adapter_id: row.adapter_id,
    mapping_id: row.mapping_id,
    job_id: row.job_id,
    source: { kind: row.source_kind, ref: row.source_ref },
    dry_run: row.dry_run === 1,
    mode: row.mode,
    stash_state_id: row.stash_state_id,
    counts: row.counts === null ? null : v.parse(countsSchema, JSON.parse(row.counts)),
    rejected_available: row.rejected_path !== null,
    rejected_path: row.rejected_path,
    actor: actorOf(row),
    created_at: row.created_at,
    finished_at: row.finished_at,
  };
}

/** The first errors of a run live on its job result (19 §19.1). */
export const ERRORS_PREVIEW = v.array(v.object({ row_number: v.number(), reason: v.string() }));

const count = (run: RunRecord, key: string): number =>
  v.parse(v.optional(v.number(), 0), run.counts?.[key]);

export function toReport(run: RunRecord): ImportReport {
  return {
    run_id: run.id,
    dry_run: run.dry_run,
    inserted: count(run, "inserted"),
    updated: count(run, "updated"),
    skipped: count(run, "skipped"),
    failed: count(run, "failed"),
    duration_ms: count(run, "duration_ms"),
    errors_preview: [],
    rejected_available: run.rejected_available,
    stash_state_id: run.stash_state_id,
  };
}
