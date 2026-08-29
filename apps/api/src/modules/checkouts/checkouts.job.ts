import type { Checkout, JsonObject } from "@testate/shared";
import * as v from "valibot";

import { notFound } from "../../lib/http/index.ts";
import type { AuditService } from "../audit/audit.service.ts";
import type { AdapterRecord } from "../adapters/adapters.repository.ts";
import type { JobRunner } from "../jobs/jobs.dispatcher.ts";
import type { JobRecord } from "../jobs/jobs.repository.ts";
import { HookAbort, hookResultsJson } from "../hooks/hooks.service.ts";
import type { HookContext, HookRunResult, HookRunner } from "../hooks/hooks.service.ts";
import type { ProjectsRepository } from "../projects/projects.repository.ts";
import type { SnapshotDeps } from "../states/states.snapshot.ts";
import { takeStash } from "../states/states.stash.ts";
import type { CheckoutsRepository } from "./checkouts.repository.ts";
import { restoreFromManifest } from "./checkouts.restore.ts";

export type CheckoutJobDeps = SnapshotDeps & {
  checkouts: CheckoutsRepository;
  hooks: HookRunner;
  projects: Pick<ProjectsRepository, "setHead" | "byId" | "usedBytes">;
  audit: AuditService;
};

export const checkoutPayloadSchema = v.object({
  checkout_id: v.string(),
  state_id: v.string(),
  adapter_ids: v.array(v.string()),
  force: v.boolean(),
  /** A retry keeps the stash of the first run (09 §9.4). */
  retry: v.optional(v.boolean(), false),
});

/** `succeeded` when every adapter restored; `partial` when at least one did; `failed` otherwise (13 §13.2). */
export function statusOf(results: Checkout["adapters"][number]["result"][]): Checkout["status"] {
  if (results.every((result) => result === "restored")) return "succeeded";
  return results.some((result) => result === "restored") ? "partial" : "failed";
}

type Payload = v.InferOutput<typeof checkoutPayloadSchema>;
type Progress = (value: JsonObject) => void;

async function restoreAll(
  deps: CheckoutJobDeps,
  checkoutId: string,
  adapters: AdapterRecord[],
  payload: Payload,
  signal: AbortSignal,
  progress: Progress
): Promise<Checkout["adapters"][number]["result"][]> {
  const manifests = new Map(
    deps.states.manifestsOf(payload.state_id).map((manifest) => [manifest.adapter_id, manifest])
  );
  const results: Checkout["adapters"][number]["result"][] = [];
  for (const adapter of adapters) {
    const manifest = manifests.get(adapter.id);
    if (manifest === undefined) continue;
    progress({
      phase: "restore",
      adapter_id: adapter.id,
      done: results.length,
      total: adapters.length,
    });
    const outcome = await restoreFromManifest(deps, adapter, manifest, {
      force: payload.force,
      signal,
      onProgress: (done, total) =>
        progress({
          phase: "restore",
          adapter_id: adapter.id,
          tables_done: done,
          tables_total: total,
        }),
    });
    deps.checkouts.setAdapterResult(checkoutId, adapter.id, outcome);
    results.push(outcome.result);
  }
  return results;
}

/** HEAD moves to the state only when every adapter restored; otherwise it is unknown (13 §13.2 step 6). */
function finish(
  deps: CheckoutJobDeps,
  job: JobRecord,
  checkoutId: string,
  payload: Payload,
  status: Checkout["status"]
): void {
  const projectId = job.project_id ?? "";
  const at = deps.now().toISOString();
  deps.checkouts.finish(checkoutId, status, at);
  if (status === "succeeded") deps.projects.setHead(projectId, payload.state_id, "at_state", at);
  else deps.projects.setHead(projectId, null, "unknown", at);
  deps.audit.record({
    actor: job.actor,
    action: "checkout.finished",
    target_type: "checkout",
    target_id: checkoutId,
    project: { id: projectId, slug: deps.projects.byId(projectId)?.slug ?? "" },
    details: { state_id: payload.state_id, status, force: payload.force },
    outcome: status === "succeeded" || status === "partial" ? "succeeded" : "failed",
  });
}

function hookContextOf(deps: CheckoutJobDeps, job: JobRecord, stateId: string): HookContext {
  const projectId = job.project_id ?? "";
  const ctx: HookContext = { projectId, jobId: job.id, actor: job.actor };
  const state = deps.states.byIdOrName(projectId, stateId);
  if (state !== null) ctx.state = { id: state.id, name: state.name };
  return ctx;
}

/**
 * The `checkout` job (13 §13.2): stash, `before_checkout` hooks (abort fails the job before any
 * restore), restore each adapter, record results, `after_checkout` hooks (abort marks it partial),
 * move HEAD.
 * ponytail: adapters restore one after another; parallel under the cap needs a per-job budget.
 */
export function createCheckoutRunner(deps: CheckoutJobDeps): JobRunner {
  return async ({ job, signal, progress }) => {
    const payload = v.parse(checkoutPayloadSchema, job.payload);
    const projectId = job.project_id ?? "";
    const checkout = deps.checkouts.byId(projectId, payload.checkout_id);
    if (checkout === null) throw notFound("checkout");
    const adapters = payload.adapter_ids.flatMap((id) => {
      const found = deps.adapters.byId(id);
      return found === null ? [] : [found];
    });
    const hookCtx = hookContextOf(deps, job, payload.state_id);
    const hooks: HookRunResult[] = [];
    try {
      if (!payload.retry) {
        progress({ phase: "stash" });
        const stashId = await takeStash(deps, {
          projectId,
          adapters,
          reason: "checkout",
          jobId: job.id,
          actor: job.actor,
          signal,
        });
        deps.checkouts.setStash(checkout.id, stashId);
      }
      progress({ phase: "hooks", trigger: "before_checkout" });
      hooks.push(...(await deps.hooks.run("before_checkout", hookCtx)));
      const results = await restoreAll(deps, checkout.id, adapters, payload, signal, progress);
      let status = statusOf(results);
      progress({ phase: "hooks", trigger: "after_checkout" });
      try {
        hooks.push(...(await deps.hooks.run("after_checkout", hookCtx)));
      } catch (cause: unknown) {
        if (!(cause instanceof HookAbort)) throw cause;
        status = status === "failed" ? "failed" : "partial";
      }
      finish(deps, job, checkout.id, payload, status);
      return {
        status: status === "partial" ? "partial" : "succeeded",
        result: {
          checkout_id: checkout.id,
          status,
          adapters: results.length,
          hooks: hookResultsJson(hooks),
        },
      };
    } catch (cause: unknown) {
      finish(deps, job, checkout.id, payload, signal.aborted ? "cancelled" : "failed");
      throw cause;
    } finally {
      deps.states.releasePins(job.id);
    }
  };
}
