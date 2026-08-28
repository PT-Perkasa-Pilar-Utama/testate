import { createDiffSchema, diffRowsQuerySchema } from "@testate/shared";
import * as v from "valibot";

import { ok, okPage, param, parseBody, parseQuery } from "../../lib/http/index.ts";
import type { Handler } from "../../lib/http/index.ts";
import type { DiffsService } from "./diffs.service.ts";

export type DiffsHandlers = {
  create: Handler;
  list: Handler;
  get: Handler;
  rows: Handler;
  export: Handler;
  remove: Handler;
};

const rowsQuery = v.object({
  adapter_id: v.array(v.string()),
  table: v.array(v.string()),
  op: v.optional(v.array(v.picklist(["added", "removed", "changed"]))),
  cursor: v.optional(v.array(v.string())),
  limit: v.optional(v.array(v.string())),
});

const exportQuery = v.object({ format: v.array(v.picklist(["csv", "jsonl"])) });

export function createDiffsHandlers(service: DiffsService, apiPrefix: string): DiffsHandlers {
  return {
    create: async (c) => {
      const body = await parseBody(c, createDiffSchema);
      const result = await service.create(
        param(c, "slug"),
        body.base_state_id,
        body.target === "live"
      );
      c.header("Location", `${apiPrefix}/jobs/${result.job.id}`);
      return ok(c, result, 202);
    },
    list: async (c) => okPage(c, await service.list(param(c, "slug")), null, 50),
    get: async (c) => ok(c, await service.get(param(c, "slug"), param(c, "id"))),
    rows: async (c) => {
      const query = parseQuery(c, rowsQuery);
      v.parse(diffRowsQuerySchema, { adapter_id: query.adapter_id[0], table: query.table[0] });
      const rows = await service.rows(param(c, "slug"), param(c, "id"), query.op?.[0]);
      return c.json(
        { data: rows, page: { next_cursor: null, limit: 100 }, masked_columns: [] },
        { status: 200 }
      );
    },
    export: async (c) => {
      const query = parseQuery(c, exportQuery);
      const rows = await service.rows(param(c, "slug"), param(c, "id"), undefined);
      const format = query.format[0] ?? "jsonl";
      c.header("Content-Disposition", `attachment; filename="diff-${param(c, "id")}.${format}"`);
      return c.text(rows.map((row) => JSON.stringify(row)).join("\n"));
    },
    remove: async (c) => {
      await service.remove(param(c, "slug"), param(c, "id"));
      return c.body(null, 204);
    },
  };
}
