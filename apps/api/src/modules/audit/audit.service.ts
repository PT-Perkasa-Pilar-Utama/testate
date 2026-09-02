import type { Actor, AuditRow, JsonObject } from "@testate/shared";

import { exportCell } from "../../lib/csv.ts";
import type { RequestMeta } from "../../lib/http/auth.ts";
import { ADAPTER_ID, AUDIT_ID, NOW, PROJECT_ID, QA_ACTOR } from "../../lib/mock/fixtures.ts";
import type {
  AuditInsert,
  AuditListQuery,
  AuditPage,
  AuditRepository,
} from "./audit.repository.ts";

export const AUDIT_ROW_MOCK: AuditRow = {
  id: AUDIT_ID,
  actor: { kind: "user", id: QA_ACTOR.id, label: QA_ACTOR.label },
  action: "checkout.created",
  target_type: "checkout",
  target_id: "01991f00-0000-7000-8000-000000000050",
  target_label: "orders",
  project: { id: PROJECT_ID, slug: "shop" },
  adapter: { id: ADAPTER_ID, name: "orders-db" },
  details: { state_name: "seeded-baseline", force: false },
  outcome: "succeeded",
  ip: "10.0.4.7",
  user_agent: "Mozilla/5.0",
  created_at: NOW,
};

/** What a module records. `actor: null` is the system (boot, retention, recovery). */
export type AuditEntry = {
  actor: Actor | null;
  action: string;
  target_type: string;
  target_id: string;
  /** What the target is called. An audit row keeps the name it had when the event happened. */
  target_label?: string;
  project?: { id: string | null; slug: string };
  adapter?: { id: string | null; name: string };
  details?: JsonObject;
  outcome: "succeeded" | "failed" | "partial";
  meta?: RequestMeta;
};

export type AuditService = {
  record(entry: AuditEntry): void;
  list(query: AuditListQuery): Promise<AuditPage>;
  total(query: AuditListQuery): Promise<number>;
  exportCsv(query: AuditListQuery): Promise<string>;
};

export type AuditDeps = { repo: AuditRepository; now?: () => Date };

const CSV_COLUMNS = [
  "created_at",
  "actor",
  "action",
  "target_type",
  "target_id",
  "project",
  "adapter",
  "outcome",
  "ip",
] as const;

function csvLine(row: AuditRow): string {
  return [
    row.created_at,
    row.actor.label,
    row.action,
    row.target_type,
    row.target_id,
    row.project?.slug ?? null,
    row.adapter?.name ?? null,
    row.outcome,
    row.ip,
  ]
    .map(exportCell)
    .join(",");
}

function actorColumns(
  actor: Actor | null
): Pick<AuditInsert, "actor_user_id" | "actor_token_id" | "actor_label"> {
  if (actor === null) return { actor_user_id: null, actor_token_id: null, actor_label: "system" };
  return {
    actor_user_id: actor.kind === "user" ? actor.id : null,
    actor_token_id: actor.kind === "token" ? actor.id : null,
    actor_label: actor.label,
  };
}

function targetColumns(
  entry: AuditEntry
): Pick<AuditInsert, "project_id" | "project_slug" | "adapter_id" | "adapter_name"> {
  return {
    project_id: entry.project?.id ?? null,
    project_slug: entry.project?.slug ?? null,
    adapter_id: entry.adapter?.id ?? null,
    adapter_name: entry.adapter?.name ?? null,
  };
}

export function createAuditService(deps: AuditDeps): AuditService {
  const now = deps.now ?? ((): Date => new Date());
  return {
    record(entry) {
      deps.repo.insert({
        id: Bun.randomUUIDv7(),
        ...actorColumns(entry.actor),
        target_label: entry.target_label ?? null,
        action: entry.action,
        target_type: entry.target_type,
        target_id: entry.target_id,
        ...targetColumns(entry),
        details: entry.details ?? {},
        outcome: entry.outcome,
        ip: entry.meta?.ip ?? null,
        user_agent: entry.meta?.user_agent ?? null,
        created_at: now().toISOString(),
      });
    },
    async list(query) {
      return deps.repo.list(query);
    },
    async total(query) {
      return deps.repo.total(query);
    },
    async exportCsv(query) {
      const lines = [CSV_COLUMNS.join(",")];
      let cursor: string | undefined;
      // Export walks every page; the list cap of 200 rows stays per page, not per export.
      do {
        const page = deps.repo.list(cursor === undefined ? { ...query } : { ...query, cursor });
        lines.push(...page.rows.map(csvLine));
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined);
      return `${lines.join("\n")}\n`;
    },
  };
}
