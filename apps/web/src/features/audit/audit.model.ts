import * as v from "valibot";
import type { AuditRow } from "@testate/shared";
import { auditRowSchema } from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";
import type { Page } from "@/lib/async.ts";
import type { Query } from "@/lib/api-client.ts";

export type AuditFilter = {
  action: string;
  actor: string;
  outcome: string;
  from: string;
  to: string;
};

/** Only the fields the person filled in; an empty box is not a filter. */
export function queryOf(filter: AuditFilter, cursor: string | undefined): Query {
  return {
    action: filter.action === "" ? undefined : filter.action,
    actor: filter.actor === "" ? undefined : filter.actor,
    outcome: filter.outcome === "" ? undefined : filter.outcome,
    from: filter.from === "" ? undefined : filter.from,
    // audit_logs.created_at is a full timestamp and the repository compares `to` with a plain
    // `<=`, not the end-of-day widening jobs/checkouts get from `createdRangeConditions`; a bare
    // date would drop every row logged later that same day (tokens.presenter.ts does the same
    // widening for expires_on).
    to: filter.to === "" ? undefined : `${filter.to}T23:59:59.999Z`,
    cursor,
  };
}

export const auditModel = {
  list: (): Promise<AuditRow[]> =>
    apiClient.get("/audit-logs", { schema: v.array(auditRowSchema) }),
  page: (filter: AuditFilter, cursor?: string): Promise<Page<AuditRow>> =>
    apiClient.page("/audit-logs", auditRowSchema, queryOf(filter, cursor)),
};
