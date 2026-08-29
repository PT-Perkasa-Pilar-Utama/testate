import type { Capabilities, RestoreStrategy } from "@testate/shared";

export type StrategyRefusal = { refused: true; reason: string };

/** Postgres strategy from what the privileges allow today (12 §12.3); degraded, never failed. */
export function selectRestoreStrategy(
  capabilities: Capabilities,
  hasDeferrable: boolean
): RestoreStrategy | StrategyRefusal {
  return {
    emptyMode: capabilities.canTruncate ? "truncate" : "delete",
    foreignKeyHandling: "dependency-order",
    transactional: capabilities.transactionalRestore,
    triggerDisable: capabilities.canDisableTriggers && !hasDeferrable,
    locking: "table",
  };
}

export function isRefusal(value: RestoreStrategy | StrategyRefusal): value is StrategyRefusal {
  return "refused" in value;
}
