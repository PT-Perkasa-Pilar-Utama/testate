import * as v from "valibot";
import type { AuditRow } from "@testate/shared";
import { auditRowSchema } from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";
import type { Page } from "@/lib/async.ts";
import type { Query } from "@/lib/api-client.ts";

export type AuditFilter = {
  /** The search box: one substring over the actor, the action and the target's name. */
  q: string;
  action: string;
  actor: string;
  outcome: string;
  from: string;
  to: string;
};

/** Only the fields the person filled in; an empty box is not a filter. */
/** A screenful. The API's own default is 50, which is two screens of scrolling before the buttons. */
export const PAGE_SIZE = 20;

export function queryOf(filter: AuditFilter, cursor: string | undefined): Query {
  return {
    limit: PAGE_SIZE,
    q: filter.q === "" ? undefined : filter.q,
    action: filter.action === "" ? undefined : filter.action,
    actor: filter.actor === "" ? undefined : filter.actor,
    outcome: filter.outcome === "" ? undefined : filter.outcome,
    from: filter.from === "" ? undefined : filter.from,
    // A bare day, which the API widens to the end of it. The screen used to append the time itself
    // because the repository compared `to` raw; it uses the shared helper now.
    to: filter.to === "" ? undefined : filter.to,
    cursor,
  };
}

export const auditModel = {
  list: (): Promise<AuditRow[]> =>
    apiClient.get("/audit-logs", { schema: v.array(auditRowSchema) }),
  page: (filter: AuditFilter, cursor?: string): Promise<Page<AuditRow>> =>
    apiClient.page("/audit-logs", auditRowSchema, queryOf(filter, cursor)),
};
