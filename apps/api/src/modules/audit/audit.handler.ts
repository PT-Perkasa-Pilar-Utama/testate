import * as v from "valibot";

import { currentActor } from "../../lib/http/auth.ts";
import { notFound, ok, okPage, param, parseQuery } from "../../lib/http/index.ts";
import type { Handler } from "../../lib/http/index.ts";
import type { AuditListQuery } from "./audit.repository.ts";
import type { AuditService } from "./audit.service.ts";

export type AuditHandlers = { list: Handler; exportCsv: Handler; payload: Handler };

const text = v.optional(v.array(v.string()));

/** Query values arrive as arrays (`c.req.queries()`); the first value of each wins. */
const listQuery = v.object({
  cursor: text,
  limit: v.optional(
    v.array(v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1), v.maxValue(200)))
  ),
  project_id: text,
  q: text,
  actor: text,
  action: text,
  from: text,
  to: text,
  outcome: v.optional(v.array(v.picklist(["succeeded", "failed", "partial"]))),
});

const TEXT_KEYS = ["cursor", "project_id", "q", "actor", "action", "from", "to"] as const;

export function toListQuery(
  parsed: v.InferOutput<typeof listQuery>,
  scope: string[] | null,
  includeInstance: boolean
): AuditListQuery {
  const query: AuditListQuery = { limit: parsed.limit?.[0] ?? 50, scope, includeInstance };
  for (const key of TEXT_KEYS) {
    const value = parsed[key]?.[0];
    if (value !== undefined) query[key] = value;
  }
  const outcome = parsed.outcome?.[0];
  if (outcome !== undefined) query.outcome = outcome;
  return query;
}

export function createAuditHandlers(service: AuditService): AuditHandlers {
  return {
    // Rows with no project are instance administration; a tester or guest reads their projects'.
    list: async (c) => {
      const query = toListQuery(
        parseQuery(c, listQuery),
        c.get("projectScope"),
        currentActor(c).role === "admin"
      );
      const page = await service.list(query);
      const total = await service.total(query);
      return okPage(c, page.rows, page.nextCursor, query.limit, total);
    },
    payload: async (c) => {
      const found = await service.payload(param(c, "id"), {
        scope: c.get("projectScope"),
        includeInstance: currentActor(c).role === "admin",
      });
      if (found === null) throw notFound("audit row");
      return ok(c, found);
    },
    exportCsv: async (c) => {
      const query = toListQuery(
        parseQuery(c, listQuery),
        c.get("projectScope"),
        currentActor(c).role === "admin"
      );
      c.header("Content-Type", "text/csv; charset=utf-8");
      c.header("Content-Disposition", 'attachment; filename="audit.csv"');
      return c.body(await service.exportCsv(query), 200);
    },
  };
}
