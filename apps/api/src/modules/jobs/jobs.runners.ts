import type { Actor, JsonObject } from "@testate/shared";
import * as v from "valibot";

import type { MetadataDb } from "../../lib/db/index.ts";
import type { AuditService } from "../audit/audit.service.ts";
import { createCheckoutRunner } from "../checkouts/checkouts.job.ts";
import type { CheckoutsRepository } from "../checkouts/checkouts.repository.ts";
import { returnToInit } from "../checkouts/checkouts.return-to-init.ts";
import type { ReturnToInitDeps } from "../checkouts/checkouts.return-to-init.ts";
import type { HookRunner } from "../hooks/hooks.service.ts";
import type { ProjectsRepository } from "../projects/projects.repository.ts";
import { createDiffRunner } from "../diffs/diffs.job.ts";
import { createImportRunner } from "../imports/imports.job.ts";
import type { ImportsRepository } from "../imports/imports.repository.ts";
import type { PoliciesRepository } from "../data/data.policies.ts";
import type { DiffsRepository } from "../diffs/diffs.repository.ts";
import { createStateDeleteRunner } from "../states/states.delete.ts";
import { createArchiveImportRunner } from "../states/states.import.ts";
import { createSnapshotRunner } from "../states/states.snapshot.ts";
import type { Dispatcher, JobRunner, JobRunnerContext } from "./jobs.dispatcher.ts";

export type RunnerDeps = ReturnToInitDeps & {
  db: MetadataDb;
  hooks: HookRunner;
  checkouts: CheckoutsRepository;
  diffs: DiffsRepository;
  imports: ImportsRepository;
  policies: PoliciesRepository;
  dataDir: string;
  audit: AuditService;
  projects: Pick<ProjectsRepository, "setHead" | "byId" | "usedBytes">;
  now: () => Date;
};

const actionSchema = v.picklist(["restore", "force", "skip"]);
const planItem = v.object({ adapter_id: v.string(), action: actionSchema });
const projectDeletePayload = v.object({ slug: v.string(), actions: v.array(planItem) });
const adapterDeletePayload = v.object({
  slug: v.string(),
  adapter_id: v.string(),
  name: v.string(),
  action: actionSchema,
});

type PlanItem = v.InferOutput<typeof planItem>;

function actorOf(job: { actor: Actor }): Actor {
  return job.actor;
}

/**
 * Every non-skipped adapter returns to init before anything is removed (13 §13.7). A failure
 * leaves everything, sets HEAD unknown, and the job fails so the plan can be retried.
 */
async function restoreAll(
  deps: RunnerDeps,
  ctx: JobRunnerContext,
  items: PlanItem[]
): Promise<JsonObject> {
  const restored: JsonObject = {};
  const pending = items.filter((item) => item.action !== "skip");
  let done = 0;
  for (const item of pending) {
    ctx.progress({ phase: "restore", adapter_id: item.adapter_id, done, total: pending.length });
    try {
      const result = await returnToInit(
        deps,
        item.adapter_id,
        item.action === "force" ? "force" : "restore",
        ctx.signal
      );
      restored[item.adapter_id] = { tables: result.tables.length, batches: result.batches };
    } catch (cause: unknown) {
      if (ctx.job.project_id !== null) {
        deps.projects.setHead(ctx.job.project_id, null, "unknown", deps.now().toISOString());
      }
      throw cause;
    }
    done += 1;
  }
  return restored;
}

/** The runners this build ships: init snapshots and deletions with return to init. */
export function registerRunners(dispatcher: Dispatcher, deps: RunnerDeps): void {
  const nowIso = (): string => deps.now().toISOString();

  const projectDelete: JobRunner = async (ctx) => {
    const { job, progress } = ctx;
    const payload = v.parse(projectDeletePayload, job.payload);
    const restored = await restoreAll(deps, ctx, payload.actions);
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
      details: { tokens_revoked: tokens, adapters: payload.actions.length, restored },
      outcome: "succeeded",
    });
    return {
      status: "succeeded",
      result: { tokens_revoked: tokens, adapters: payload.actions.length, restored },
    };
  };

  const adapterDelete: JobRunner = async (ctx) => {
    const { job, progress } = ctx;
    const payload = v.parse(adapterDeletePayload, job.payload);
    const restored = await restoreAll(deps, ctx, [payload]);
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
      details: { action: payload.action, manifests_marked: removed, restored },
      outcome: "succeeded",
    });
    return { status: "succeeded", result: { manifests_marked: removed, restored } };
  };

  dispatcher.registerKind("project_delete", projectDelete);
  dispatcher.registerKind("adapter_delete", adapterDelete);
  dispatcher.registerKind("snapshot", createSnapshotRunner(deps));
  dispatcher.registerKind("state_delete", createStateDeleteRunner(deps));
  dispatcher.registerKind("checkout", createCheckoutRunner(deps));
  dispatcher.registerKind("diff", createDiffRunner(deps));
  dispatcher.registerKind("import", createImportRunner(deps));
  dispatcher.registerKind(
    "archive_import",
    createArchiveImportRunner({ ...deps, uploads: deps.imports })
  );
}
