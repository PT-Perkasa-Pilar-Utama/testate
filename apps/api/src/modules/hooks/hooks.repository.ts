import type { Hook } from "@testate/shared";
import { hookTriggerSchema } from "@testate/shared";
import * as v from "valibot";

import type { MetadataDb } from "../../lib/db/index.ts";

export type HookPatch = {
  enabled?: boolean;
  fail_policy?: Hook["fail_policy"];
  rest_request_id?: string;
};

export type NewHookRun = {
  id: string;
  hook_id: string;
  job_id: string;
  request_run_id: string | null;
  status: "succeeded" | "failed" | "skipped";
  started_at: string;
  finished_at: string;
};

export type HooksRepository = {
  list(projectId: string, trigger?: Hook["trigger"]): Hook[];
  byId(projectId: string, id: string): Hook | null;
  insert(
    projectId: string,
    hook: Omit<Hook, "request" | "position"> & { rest_request_id: string }
  ): Hook;
  update(id: string, patch: HookPatch, at: string): void;
  remove(id: string): void;
  /** Positions follow the order of `ids`, one-based (13 §13.4). */
  reorder(ids: string[], at: string): void;
  insertRun(run: NewHookRun): void;
};

const hookRow = v.object({
  id: v.string(),
  trigger: hookTriggerSchema,
  rest_request_id: v.string(),
  adapter_id: v.string(),
  request_name: v.string(),
  position: v.number(),
  enabled: v.number(),
  fail_policy: v.picklist(["abort", "continue"]),
  created_at: v.string(),
  updated_at: v.string(),
});

const SELECT = `
  SELECT h.*, r.adapter_id, r.name AS request_name
  FROM hooks h JOIN rest_requests r ON r.id = h.rest_request_id`;

function toHook(row: v.InferOutput<typeof hookRow>): Hook {
  return {
    id: row.id,
    trigger: row.trigger,
    request: { id: row.rest_request_id, adapter_id: row.adapter_id, name: row.request_name },
    position: row.position,
    enabled: row.enabled === 1,
    fail_policy: row.fail_policy,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createHooksRepository(db: MetadataDb): HooksRepository {
  const one = (projectId: string, id: string): Hook | null => {
    const row = db.query(`${SELECT} WHERE h.project_id = ? AND h.id = ?`).get(projectId, id);
    return row === null ? null : toHook(v.parse(hookRow, row));
  };
  return {
    list(projectId, trigger) {
      const rows =
        trigger === undefined
          ? db
              .query(`${SELECT} WHERE h.project_id = ? ORDER BY h.trigger, h.position`)
              .all(projectId)
          : db
              .query(`${SELECT} WHERE h.project_id = ? AND h.trigger = ? ORDER BY h.position`)
              .all(projectId, trigger);
      return v.parse(v.array(hookRow), rows).map(toHook);
    },
    byId: one,
    insert(projectId, hook) {
      const next = v.parse(
        v.object({ n: v.number() }),
        db
          .query(
            "SELECT COALESCE(MAX(position), 0) + 1 AS n FROM hooks WHERE project_id = ? AND trigger = ?"
          )
          .get(projectId, hook.trigger)
      ).n;
      db.query(
        `INSERT INTO hooks (id, project_id, trigger, rest_request_id, position, enabled, fail_policy, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        hook.id,
        projectId,
        hook.trigger,
        hook.rest_request_id,
        next,
        hook.enabled ? 1 : 0,
        hook.fail_policy,
        hook.created_at,
        hook.updated_at
      );
      const inserted = one(projectId, hook.id);
      if (inserted === null) throw new Error("hook insert failed");
      return inserted;
    },
    update(id, patch, at) {
      const sets = ["updated_at = ?"];
      const params: (string | number)[] = [at];
      if (patch.enabled !== undefined) {
        sets.push("enabled = ?");
        params.push(patch.enabled ? 1 : 0);
      }
      if (patch.fail_policy !== undefined) {
        sets.push("fail_policy = ?");
        params.push(patch.fail_policy);
      }
      if (patch.rest_request_id !== undefined) {
        sets.push("rest_request_id = ?");
        params.push(patch.rest_request_id);
      }
      db.query(`UPDATE hooks SET ${sets.join(", ")} WHERE id = ?`).run(...params, id);
    },
    remove(id) {
      db.query("DELETE FROM hooks WHERE id = ?").run(id);
    },
    reorder(ids, at) {
      db.transaction(() => {
        for (const [index, id] of ids.entries()) {
          db.query("UPDATE hooks SET position = ?, updated_at = ? WHERE id = ?").run(
            index + 1,
            at,
            id
          );
        }
      })();
    },
    insertRun(run) {
      db.query(
        `INSERT INTO hook_runs (id, hook_id, job_id, request_run_id, status, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        run.id,
        run.hook_id,
        run.job_id,
        run.request_run_id,
        run.status,
        run.started_at,
        run.finished_at
      );
    },
  };
}
