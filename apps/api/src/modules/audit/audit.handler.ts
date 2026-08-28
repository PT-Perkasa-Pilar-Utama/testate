import * as v from "valibot";

import { okPage, parseQuery } from "../../lib/http/index.ts";
import type { Handler } from "../../lib/http/index.ts";
import type { AuditFilter, AuditService } from "./audit.service.ts";

export type AuditHandlers = { list: Handler; exportCsv: Handler };

const filterQuery = v.object({
  action: v.optional(v.array(v.string())),
  outcome: v.optional(v.array(v.picklist(["succeeded", "failed", "partial"]))),
});

export function createAuditHandlers(service: AuditService): AuditHandlers {
  const filterOf = (c: Parameters<Handler>[0]): AuditFilter => {
    const query = parseQuery(c, filterQuery);
    const filter: AuditFilter = {};
    if (query.action?.[0] !== undefined) filter.action = query.action[0];
    if (query.outcome?.[0] !== undefined) filter.outcome = query.outcome[0];
    return filter;
  };
  return {
    list: async (c) => okPage(c, await service.list(filterOf(c)), null, 50),
    exportCsv: async (c) => {
      c.header("Content-Type", "text/csv; charset=utf-8");
      c.header("Content-Disposition", 'attachment; filename="audit.csv"');
      return c.body(await service.exportCsv(filterOf(c)), 200);
    },
  };
}
