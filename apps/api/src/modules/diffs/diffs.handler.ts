import { createDiffSchema } from "@testate/shared";
import type { JsonValue } from "@testate/shared";
import * as v from "valibot";

import { currentActor, requestMeta } from "../../lib/http/auth.ts";
import { ok, okPage, param, parseBody, parseQuery } from "../../lib/http/index.ts";
import type { Handler } from "../../lib/http/index.ts";
import { firstQuery } from "../../lib/http/query.ts";
import type { DiffRowsQuery, DiffsService } from "./diffs.service.ts";

export type DiffsHandlers = {
  create: Handler;
  list: Handler;
  get: Handler;
  rows: Handler;
  export: Handler;
  remove: Handler;
};

const limitQuery = v.optional(
  v.array(v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1), v.maxValue(500)))
);
const rowsQuery = v.object({
  adapter_id: v.array(v.string()),
  table: v.array(v.string()),
  op: v.optional(v.array(v.picklist(["added", "removed", "changed"]))),
  cursor: v.optional(v.array(v.string())),
  limit: limitQuery,
});
const listQuery = v.object({ limit: limitQuery });
const exportQuery = v.object({
  format: v.array(v.picklist(["csv", "jsonl"])),
  adapter_id: v.optional(v.array(v.string())),
  table: v.optional(v.array(v.string())),
});

function toRowsQuery(parsed: v.InferOutput<typeof rowsQuery>): DiffRowsQuery {
  const query: DiffRowsQuery = {
    adapter_id: parsed.adapter_id[0] ?? "",
    table: parsed.table[0] ?? "",
    limit: firstQuery(parsed.limit) ?? 100,
  };
  const op = firstQuery(parsed.op);
  if (op !== undefined) query.op = op;
  const cursor = firstQuery(parsed.cursor);
  if (cursor !== undefined) query.cursor = cursor;
  return query;
}

function csvCell(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return '""';
  const text = v.is(v.string(), value) ? value : JSON.stringify(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function createDiffsHandlers(
  service: DiffsService,
  apiPrefix: string,
  trustProxy: boolean
): DiffsHandlers {
  const meta = (c: Parameters<Handler>[0]): ReturnType<typeof requestMeta> =>
    requestMeta(c, trustProxy);
  return {
    create: async (c) => {
      const body = await parseBody(c, createDiffSchema);
      const result = await service.create(
        currentActor(c),
        param(c, "slug"),
        body.base_state_id,
        body.target,
        body.adapter_ids,
        meta(c)
      );
      c.header("Location", `${apiPrefix}/jobs/${result.job.id}`);
      return ok(c, result, 202);
    },
    list: async (c) => {
      const limit = firstQuery(parseQuery(c, listQuery).limit) ?? 50;
      return okPage(c, await service.list(param(c, "slug"), limit), null, limit);
    },
    get: async (c) => ok(c, await service.get(param(c, "slug"), param(c, "id"))),
    rows: async (c) => {
      const query = toRowsQuery(parseQuery(c, rowsQuery));
      const page = await service.rows(currentActor(c), param(c, "slug"), param(c, "id"), query);
      return c.json(
        {
          data: page.data,
          page: { next_cursor: page.next_cursor, limit: query.limit },
          masked_columns: page.masked_columns,
        },
        { status: 200 }
      );
    },
    /** CSV: op, key, then before.<col> and after.<col>; JSON lines otherwise (20 §20.1). */
    export: async (c) => {
      const query = parseQuery(c, exportQuery);
      const format = query.format[0] ?? "jsonl";
      const rows = service.exportRows(
        currentActor(c),
        param(c, "slug"),
        param(c, "id"),
        firstQuery(query.adapter_id),
        firstQuery(query.table)
      );
      const lines: string[] = [];
      for await (const row of rows) {
        if (format === "jsonl") {
          lines.push(JSON.stringify(row));
          continue;
        }
        const columns = [
          ...new Set([...Object.keys(row.before ?? {}), ...Object.keys(row.after ?? {})]),
        ].sort();
        const cells = [
          row.table,
          row.op,
          JSON.stringify(row.k),
          ...columns.map((name) => csvCell(row.before?.[name])),
          ...columns.map((name) => csvCell(row.after?.[name])),
        ];
        lines.push(cells.map(csvCell).join(","));
      }
      c.header("Content-Disposition", `attachment; filename="diff-${param(c, "id")}.${format}"`);
      return c.text(lines.join("\n"));
    },
    remove: async (c) => {
      await service.remove(currentActor(c), param(c, "slug"), param(c, "id"), meta(c));
      return c.body(null, 204);
    },
  };
}
