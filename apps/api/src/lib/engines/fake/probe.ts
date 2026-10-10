import type { ProbeResult } from "@testate/shared";

/** What the fake engine reports for every database it knows (12 §12.2). */
export const PROBE: Omit<ProbeResult, "version"> = {
  engine: "postgres",
  dialect: "postgres",
  meets_floor: true,
  floor: "13",
  tier: "tabular",
  capabilities: {
    canTruncate: true,
    canDisableTriggers: false,
    canTerminateSessions: true,
    supportsDeferrableConstraints: false,
    transactionalRestore: true,
    snapshotRead: "repeatable-read",
    timeSeriesDeletes: false,
    serverLogs: ["statements"],
  },
  strategy: {
    emptyMode: "truncate",
    foreignKeyHandling: "dependency-order",
    transactional: true,
    triggerDisable: false,
    locking: "table",
  },
  read_only_enforcement: "transaction",
  table_count: 0,
  size_estimate_bytes: 0,
  atomicity_notice: "fake",
  warnings: [],
};
