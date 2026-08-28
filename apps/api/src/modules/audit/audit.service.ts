import type { AuditRow } from "@testate/shared";

import { ADAPTER_ID, AUDIT_ID, NOW, PROJECT_ID, QA_ACTOR } from "../../lib/mock/fixtures.ts";

export const AUDIT_ROW_MOCK: AuditRow = {
  id: AUDIT_ID,
  actor: { kind: "user", id: QA_ACTOR.id, label: QA_ACTOR.label },
  action: "checkout.created",
  target_type: "checkout",
  target_id: "01991f00-0000-7000-8000-000000000050",
  project: { id: PROJECT_ID, slug: "shop" },
  adapter: { id: ADAPTER_ID, name: "orders-db" },
  details: { state_name: "seeded-baseline", force: false },
  outcome: "succeeded",
  ip: "10.0.4.7",
  user_agent: "Mozilla/5.0",
  created_at: NOW,
};

export type AuditFilter = { action?: string; outcome?: string };

export type AuditService = {
  list(filter: AuditFilter): Promise<AuditRow[]>;
  exportCsv(filter: AuditFilter): Promise<string>;
};

/** SCAFFOLD: one row. The audit card wires the repository; every module writes through it. */
export function createAuditService(): AuditService {
  const filtered = (filter: AuditFilter): AuditRow[] =>
    [AUDIT_ROW_MOCK].filter(
      (row) =>
        (filter.action === undefined || row.action.startsWith(filter.action)) &&
        (filter.outcome === undefined || row.outcome === filter.outcome)
    );
  return {
    async list(filter) {
      return filtered(filter);
    },
    async exportCsv(filter) {
      const rows = filtered(filter).map((row) =>
        [
          row.created_at,
          row.actor.label,
          row.action,
          row.target_type,
          row.target_id,
          row.outcome ?? "",
        ].join(",")
      );
      return `created_at,actor,action,target_type,target_id,outcome\n${rows.join("\n")}\n`;
    },
  };
}
