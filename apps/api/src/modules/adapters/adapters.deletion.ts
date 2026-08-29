import { conflict } from "../../lib/http/index.ts";
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
      // SCAFFOLD: reachability, init-state lookup, and drift land with the engine cards.
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
