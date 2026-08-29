import type { Actor, Job, JsonObject } from "@testate/shared";

import type { RequestMeta } from "../../lib/http/auth.ts";
import { conflict } from "../../lib/http/index.ts";
import { idempotentRequest } from "../jobs/jobs.idempotency.ts";
import type { EnqueueInput, JobsService } from "../jobs/jobs.service.ts";
import type { AdapterRecord, AdaptersRepository } from "./adapters.repository.ts";

export type DeletionAction = "restore" | "force" | "skip";

export type AdapterDeletionPlan = {
  plan_id: string;
  expires_at: string;
  adapter: {
    action: DeletionAction;
    reason?: "read_only" | "unreachable" | "no_init_state" | "removed";
    drift: null;
  };
  states_referencing: number;
};

/** The client's deletion request, hashed under its `Idempotency-Key` so a retry replays it. */
export function deletionBody(
  slug: string,
  adapterId: string,
  planId: string,
  action: DeletionAction
): JsonObject {
  return { slug, adapter_id: adapterId, plan_id: planId, action };
}

export type DeletionPlans = {
  plan(adapter: AdapterRecord): AdapterDeletionPlan;
  /** Validates and consumes a plan; throws CONFLICT when stale or the action is not allowed. */
  consume(adapterId: string, planId: string, action: DeletionAction): void;
};

export const PLAN_TTL_MS = 15 * 60 * 1000;

type StoredPlan = AdapterDeletionPlan & { adapterId: string };

/** Deletion plans live in memory for 15 minutes (05 §5.8); expired ones are swept on each new plan. */
export function createDeletionPlans(
  repo: Pick<AdaptersRepository, "statesReferencing">,
  now: () => Date
): DeletionPlans {
  const plans = new Map<string, StoredPlan>();
  const nowIso = (): string => now().toISOString();
  return {
    plan(adapter) {
      for (const [planId, stored] of plans) if (stored.expires_at <= nowIso()) plans.delete(planId);
      const skip = adapter.kind !== "database" || adapter.mode === "read_only";
      const plan: StoredPlan = {
        plan_id: Bun.randomUUIDv7(),
        expires_at: new Date(now().getTime() + PLAN_TTL_MS).toISOString(),
        adapter: skip
          ? { action: "skip", reason: "read_only", drift: null }
          : { action: "restore", drift: null },
        states_referencing: repo.statesReferencing(adapter.id),
        adapterId: adapter.id,
      };
      plans.set(plan.plan_id, plan);
      const { adapterId: _adapterId, ...view } = plan;
      return view;
    },
    consume(adapterId, planId, action) {
      const plan = plans.get(planId);
      if (plan === undefined || plan.adapterId !== adapterId || plan.expires_at <= nowIso()) {
        throw conflict("deletion plan is stale");
      }
      const allowed: DeletionAction[] =
        plan.adapter.action === "skip" ? ["skip"] : ["restore", "skip"];
      if (!allowed.includes(action)) throw conflict("action not allowed by the plan", { action });
      plans.delete(planId);
    },
  };
}

export type RemoveDeps = {
  jobs: Pick<JobsService, "enqueue" | "replay">;
  plans: DeletionPlans;
  /** Looked up only after the replay check: a retry runs when the adapter row is already gone. */
  adapterOf: () => AdapterRecord;
  record: (adapter: AdapterRecord, details: JsonObject) => void;
};

/**
 * The delete job for one adapter (11 §11.6). A repeated `Idempotency-Key` answers with the first
 * job, before the adapter is looked up or its plan consumed a second time.
 */
export async function enqueueDeletion(
  deps: RemoveDeps,
  slug: string,
  id: string,
  planId: string,
  action: DeletionAction,
  actor: Actor,
  meta: RequestMeta
): Promise<Job> {
  const idempotency = idempotentRequest(
    meta,
    "adapter_delete",
    deletionBody(slug, id, planId, action)
  );
  const replayed = idempotency === undefined ? null : await deps.jobs.replay(idempotency, actor);
  if (replayed !== null) return replayed;
  const adapter = deps.adapterOf();
  deps.plans.consume(adapter.id, planId, action);
  deps.record(adapter, { plan_id: planId, action });
  const request: EnqueueInput = {
    kind: "adapter_delete",
    projectId: adapter.project_id,
    adapterIds: [adapter.id],
    payload: { slug, adapter_id: adapter.id, name: adapter.name, action },
    actor,
    parentRequestId: meta.request_id,
  };
  if (idempotency !== undefined) request.idempotency = idempotency;
  return deps.jobs.enqueue(request);
}
