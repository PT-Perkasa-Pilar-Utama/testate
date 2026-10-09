import { conflict } from "../../lib/http/index.ts";
import type { DeletionCounts } from "./projects.repository.ts";
import type { AdapterSummary } from "./projects.service.ts";

export type PlanAdapter = {
  adapter_id: string;
  name: string;
  engine: string;
  init_state_id: string | null;
  action: "restore" | "force" | "skip" | "none";
  reason?: "read_only" | "unreachable" | "no_init_state" | "removed";
  drift: null;
};

export type DeletionPlan = {
  plan_id: string;
  expires_at: string;
  protected_states: number;
  /** Everything the deletion takes with the project; the dialog names it before the slug is typed. */
  affected: DeletionCounts;
  adapters: PlanAdapter[];
};

export type DeletionInput = {
  confirm_slug: string;
  plan_id: string;
  adapters: { adapter_id: string; action: "restore" | "force" | "skip" }[];
};

/** The deletion plan per adapter (05 §5.4); reachability and drift come from the adapters service. */
export function planFor(adapter: AdapterSummary): PlanAdapter {
  const base = {
    adapter_id: adapter.id,
    name: adapter.name,
    engine: adapter.engine,
    init_state_id: null,
    drift: null,
  };
  if (adapter.kind !== "database") return { ...base, action: "none" };
  if (adapter.mode === "read_only") return { ...base, action: "skip", reason: "read_only" };
  return { ...base, action: "restore" };
}

/** Which plan actions a request may pick per adapter (04 §4.8 step 1). */
function allowedActions(planned: PlanAdapter): readonly string[] {
  if (planned.action === "skip" || planned.action === "none") return ["skip"];
  return planned.drift === null ? ["restore", "skip"] : ["restore", "force", "skip"];
}

/** Every database adapter in the plan needs an action the plan allows (04 §4.8 step 1). */
export function assertActionsAllowed(plan: DeletionPlan, chosen: Map<string, string>): void {
  for (const planned of plan.adapters) {
    if (planned.action === "none") continue;
    const action = chosen.get(planned.adapter_id);
    if (action === undefined) {
      throw conflict("every database adapter needs an action", { adapter_id: planned.adapter_id });
    }
    if (!allowedActions(planned).includes(action)) {
      throw conflict("action not allowed by the plan", { adapter_id: planned.adapter_id, action });
    }
  }
}
