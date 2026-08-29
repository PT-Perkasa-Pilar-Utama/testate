import type { Actor } from "@testate/shared";
import * as v from "valibot";

import type { MetadataDb } from "../../lib/db/index.ts";
import { AppError } from "../../lib/http/index.ts";
import type { AuditService } from "../audit/audit.service.ts";
import type { Dispatcher, JobRunner } from "./jobs.dispatcher.ts";

export type RunnerDeps = { db: MetadataDb; audit: AuditService; now: () => Date };

const actionSchema = v.picklist(["restore", "force", "skip"]);
const projectDeletePayload = v.object({
  slug: v.string(),
  actions: v.array(v.object({ adapter_id: v.string(), action: actionSchema })),
});
const adapterDeletePayload = v.object({
  slug: v.string(),
  adapter_id: v.string(),
  name: v.string(),
  action: actionSchema,
});

/** SCAFFOLD: no engine can restore yet, so a `restore` or `force` action fails the job (13 §13.7). */
function requireNoRestore(actions: readonly { adapter_id: string; action: string }[]): void {
  const needs = actions.find((item) => item.action !== "skip");
  if (needs !== undefined) {
    throw new AppError(
      "ENGINE_UNSUPPORTED",
      "return to init needs a database engine; none is available in this build",
      {
        adapter_id: needs.adapter_id,
        action: needs.action,
      }
    );
  }
}

function actorOf(job: { actor: Actor }): Actor {
  return job.actor;
}

/** The runners this build ships: deletions do the row work; snapshots are still scaffolds. */
export function registerRunners(dispatcher: Dispatcher, deps: RunnerDeps): void {
  const nowIso = (): string => deps.now().toISOString();

  const projectDelete: JobRunner = async ({ job, progress }) => {
    const payload = v.parse(projectDeletePayload, job.payload);
    progress({ phase: "restore", done: 0, total: payload.actions.length });
    requireNoRestore(payload.actions);
    progress({ phase: "remove" });
    const tokens = deps.db
      .query("UPDATE api_tokens SET revoked_at = ? WHERE revoked_at IS NULL AND project_ids LIKE ?")
      .run(nowIso(), `%"${job.project_id ?? ""}"%`).changes;
    deps.db.query("DELETE FROM projects WHERE id = ?").run(job.project_id);
    deps.audit.record({
      actor: actorOf(job),
      action: "project.deleted",
      target_type: "project",
      target_id: job.project_id ?? "",
      project: { id: job.project_id, slug: payload.slug },
      details: { tokens_revoked: tokens, adapters: payload.actions.length },
      outcome: "succeeded",
    });
    return {
      status: "succeeded",
      result: { tokens_revoked: tokens, adapters_skipped: payload.actions.length },
    };
  };

  const adapterDelete: JobRunner = async ({ job, progress }) => {
    const payload = v.parse(adapterDeletePayload, job.payload);
    progress({ phase: "restore" });
    requireNoRestore([payload]);
    progress({ phase: "remove" });
    const removed = deps.db
      .query("UPDATE state_adapters SET removed = 1 WHERE adapter_id = ?")
      .run(payload.adapter_id).changes;
    deps.db.query("DELETE FROM adapters WHERE id = ?").run(payload.adapter_id);
    deps.audit.record({
      actor: actorOf(job),
      action: "adapter.deleted",
      target_type: "adapter",
      target_id: payload.adapter_id,
      project: { id: job.project_id, slug: payload.slug },
      adapter: { id: payload.adapter_id, name: payload.name },
      details: { action: payload.action, manifests_marked: removed },
      outcome: "succeeded",
    });
    return { status: "succeeded", result: { manifests_marked: removed } };
  };

  // SCAFFOLD: the states card snapshots through the engine port; today the init job records nothing.
  const snapshot: JobRunner = async ({ progress }) => {
    progress({ phase: "scaffold" });
    return {
      status: "succeeded",
      result: { init: true, note: "no engine in this build; no data captured" },
    };
  };

  dispatcher.registerKind("project_delete", projectDelete);
  dispatcher.registerKind("adapter_delete", adapterDelete);
  dispatcher.registerKind("snapshot", snapshot);
}
