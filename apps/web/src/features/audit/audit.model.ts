import * as v from "valibot";
import type { AuditRow } from "@testate/shared";
import { auditRowSchema } from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";
import type { Query } from "@/lib/api-client.ts";

export type AuditFilter = { action: string; actor: string; outcome: string };

/** Only the fields the person filled in; an empty box is not a filter. */
function queryOf(filter: AuditFilter, cursor: string | undefined): Query {
  return {
    action: filter.action === "" ? undefined : filter.action,
    actor: filter.actor === "" ? undefined : filter.actor,
    outcome: filter.outcome === "" ? undefined : filter.outcome,
    cursor,
  };
}

export const auditModel = {
  list: (): Promise<AuditRow[]> =>
    apiClient.get("/audit-logs", { schema: v.array(auditRowSchema) }),
  page: (
    filter: AuditFilter,
    cursor?: string
  ): Promise<{ data: AuditRow[]; next: string | null }> =>
    apiClient.page("/audit-logs", auditRowSchema, queryOf(filter, cursor)),
};
