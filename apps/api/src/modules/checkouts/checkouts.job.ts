import type { Checkout, JsonObject } from "@testate/shared";
import * as v from "valibot";

import { runLanes } from "../../lib/async/lanes.ts";
import { laneOf } from "../states/states.snapshot.ts";

import { notFound } from "../../lib/http/index.ts";
import type { AuditService } from "../audit/audit.service.ts";
import type { AdapterRecord } from "../adapters/adapters.repository.ts";
import type { JobRunner } from "../jobs/jobs.dispatcher.ts";
import type { JobRecord } from "../jobs/jobs.repository.ts";
import type { ProjectsRepository } from "../projects/projects.repository.ts";
import type { SnapshotDeps } from "../states/states.snapshot.ts";
import { takeStash } from "../states/states.stash.ts";
import type { CheckoutsRepository } from "./checkouts.repository.ts";
import { restoreFromManifest } from "./checkouts.restore.ts";

export type CheckoutJobDeps = SnapshotDeps & {
  checkouts: CheckoutsRepository;
  projects: Pick<
    ProjectsRepository,
    "markHeadDirty" | "setHead" | "byId" | "usedBytes" | "instanceUsedBytes"
  >;
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
  const covered = adapters.filter((adapter) => manifests.has(adapter.id));
  let finished = 0;
  return runLanes(covered, laneOf, deps.adapterLanes ?? 1, async (adapter) => {
    const manifest = manifests.get(adapter.id);
    if (manifest === undefined) throw notFound("manifest");
    progress({ phase: "restore", adapter_id: adapter.id, done: finished, total: covered.length });
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
    finished += 1;
    return outcome.result;
  });
}

/** HEAD moves to the state only when every adapter restored; otherwise it is unknown (13 §13.2 step 6). */
function finish(
  deps: CheckoutJobDeps,
  job: JobRecord,
  checkoutId: string,
  stateName: string,
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
    target_label: stateName,
    project: { id: projectId, slug: deps.projects.byId(projectId)?.slug ?? "" },
    details: { state_id: payload.state_id, status, force: payload.force },
    outcome: status === "succeeded" || status === "partial" ? "succeeded" : "failed",
  });
}

/**
 * The `checkout` job (13 §13.2): stash, restore each adapter, record results, move HEAD.
 * Adapters on distinct targets restore in parallel up to `adapterLanes`; one target stays sequential.
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
      const results = await restoreAll(deps, checkout.id, adapters, payload, signal, progress);
      const status = statusOf(results);
      finish(deps, job, checkout.id, checkout.state.name, payload, status);
      return {
        status: status === "partial" ? "partial" : "succeeded",
        result: {
          checkout_id: checkout.id,
          status,
          adapters: results.length,
        },
      };
    } catch (cause: unknown) {
      finish(
        deps,
        job,
        checkout.id,
        checkout.state.name,
        payload,
        signal.aborted ? "cancelled" : "failed"
      );
      throw cause;
    } finally {
      deps.states.releasePins(job.id);
    }
  };
}
