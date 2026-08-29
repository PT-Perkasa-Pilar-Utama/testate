import {
  fixtureRequestSchema,
  jsonObjectSchema,
  queryRequestSchema,
  rowEditsSchema,
  upsertColumnPolicySchema,
} from "@testate/shared";
import * as v from "valibot";

import type { FilterOp, PageQuery, RowFilter } from "../../lib/engines/index.ts";
import { currentActor, requestMeta } from "../../lib/http/auth.ts";
import { AppError, ok, okPage, param, parseBody, parseQuery } from "../../lib/http/index.ts";
import type { Handler } from "../../lib/http/index.ts";
import { firstQuery } from "../../lib/http/query.ts";
import type { DataService, SavedQueryInput } from "./data.service.ts";

export type DataHandlers = {
  schema: Handler;
  rows: Handler;
  lookup: Handler;
  startWriteSession: Handler;
  setWriteSessionOptions: Handler;
  endWriteSession: Handler;
  rowEdits: Handler;
  query: Handler;
  queryExport: Handler;
  runningQueries: Handler;
  cancelQuery: Handler;
  savedQueries: Handler;
  createSavedQuery: Handler;
  updateSavedQuery: Handler;
  removeSavedQuery: Handler;
  history: Handler;
  policies: Handler;
  upsertPolicy: Handler;
  removePolicy: Handler;
  fixture: Handler;
};

const FILTER_OPS = ["eq", "ne", "lt", "le", "gt", "ge", "like", "in", "null", "notnull"] as const;
const filterOpSchema = v.picklist(FILTER_OPS);

const rowsQuery = v.object({
  cursor: v.optional(v.array(v.string())),
  limit: v.optional(v.array(v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1), v.maxValue(500)))),
  sort: v.optional(v.array(v.string())),
  order: v.optional(v.array(v.picklist(["asc", "desc"]))),
  filter: v.optional(v.array(v.string())),
});
const lookupQuerySchema = v.object({ column: v.array(v.string()), q: v.optional(v.array(v.string())) });
const sessionBodySchema = v.object({ foreign_key_checks: v.optional(v.boolean(), true) });
const savedQueryBody = v.object({ name: v.pipe(v.string(), v.minLength(1), v.maxLength(80)), body: jsonObjectSchema });
const historyQuery = v.object({
  limit: v.optional(v.array(v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1), v.maxValue(200)))),
  mode: v.optional(v.array(v.picklist(["read", "write"]))),
});

/** `filter=<column>:<op>:<value>`; `null` and `notnull` take no value (06 §6.2). */
export function parseFilter(text: string): RowFilter {
  const [column, op, ...rest] = text.split(":");
  const parsedOp = v.safeParse(filterOpSchema, op);
  if (column === undefined || column === "" || !parsedOp.success) {
    throw new AppError("VALIDATION_ERROR", `invalid filter ${text}`, { filter: text });
  }
  const filterOp: FilterOp = parsedOp.output;
  return { column, op: filterOp, value: rest.join(":") };
}

function toPageQuery(parsed: v.InferOutput<typeof rowsQuery>): Partial<PageQuery> {
  const query: Partial<PageQuery> = {
    limit: firstQuery(parsed.limit) ?? 100,
    order: firstQuery(parsed.order) ?? "asc",
    filters: (parsed.filter ?? []).map(parseFilter),
  };
  const cursor = firstQuery(parsed.cursor);
  if (cursor !== undefined) query.cursor = cursor;
  const sort = firstQuery(parsed.sort);
  if (sort !== undefined) query.sort = sort;
  return query;
}

export function createDataHandlers(service: DataService, trustProxy: boolean): DataHandlers {
  const meta = (c: Parameters<Handler>[0]): ReturnType<typeof requestMeta> => requestMeta(c, trustProxy);
  return {
    schema: async (c) => ok(c, await service.schema(param(c, "id"))),
    rows: async (c) => {
      const page = await service.rows(param(c, "id"), param(c, "table"), toPageQuery(parseQuery(c, rowsQuery)));
      return c.json(page, { status: 200 });
    },
    lookup: async (c) => {
      const query = parseQuery(c, lookupQuerySchema);
      return ok(c, await service.lookup(param(c, "id"), param(c, "table"), query.column[0] ?? ""));
    },
    startWriteSession: async (c) => {
      const body = await parseBody(c, sessionBodySchema);
      return ok(c, await service.startWriteSession(currentActor(c), param(c, "id"), body.foreign_key_checks, meta(c)), 201);
    },
    setWriteSessionOptions: async (c) => {
      const body = await parseBody(c, sessionBodySchema);
      return ok(c, await service.setWriteSessionOptions(currentActor(c), param(c, "sid"), body.foreign_key_checks, meta(c)));
    },
    endWriteSession: async (c) => {
      await service.endWriteSession(currentActor(c), param(c, "sid"), meta(c));
      return c.body(null, 204);
    },
    rowEdits: async (c) => {
      const body = await parseBody(c, rowEditsSchema);
      return ok(c, await service.rowEdits(param(c, "id"), param(c, "table"), body.write_session_id, body.edits.length));
    },
    query: async (c) => {
      const body = await parseBody(c, queryRequestSchema);
      return ok(c, await service.query(currentActor(c), param(c, "id"), body));
    },
    // SCAFFOLD: export streams the same result as a file once the data card's second half lands (06 §6.8).
    queryExport: async (c) => {
      const body = await parseBody(c, v.object({ ...queryRequestSchema.entries, format: v.picklist(["csv", "json"]) }));
      const result = await service.query(currentActor(c), param(c, "id"), { ...body, mode: "read" });
      c.header("Content-Disposition", `attachment; filename="query-${result.query_id}.${body.format}"`);
      const csv = result.rows.map((row) => Object.values(row).map((value) => JSON.stringify(value)).join(",")).join("\n");
      return c.text(body.format === "json" ? JSON.stringify(result.rows) : csv);
    },
    runningQueries: async (c) => okPage(c, await service.runningQueries(param(c, "id")), null, 50),
    cancelQuery: async (c) => {
      await service.cancelQuery(currentActor(c), param(c, "id"), param(c, "query_id"));
      return c.body(null, 204);
    },
    savedQueries: async (c) => okPage(c, await service.savedQueries(param(c, "id")), null, 200),
    createSavedQuery: async (c) => {
      const body = await parseBody(c, savedQueryBody);
      return ok(c, await service.createSavedQuery(currentActor(c), param(c, "id"), body), 201);
    },
    updateSavedQuery: async (c) => {
      const body = await parseBody(c, v.partial(savedQueryBody));
      const patch: Partial<SavedQueryInput> = {};
      if (body.name !== undefined) patch.name = body.name;
      if (body.body !== undefined) patch.body = body.body;
      return ok(c, await service.updateSavedQuery(param(c, "id"), param(c, "qid"), patch));
    },
    removeSavedQuery: async (c) => {
      await service.removeSavedQuery(param(c, "id"), param(c, "qid"));
      return c.body(null, 204);
    },
    history: async (c) => {
      const query = parseQuery(c, historyQuery);
      const limit = firstQuery(query.limit) ?? 50;
      return okPage(c, await service.history(currentActor(c), param(c, "id"), limit, firstQuery(query.mode)), null, limit);
    },
    policies: async (c) => okPage(c, await service.policies(param(c, "id")), null, 200),
    upsertPolicy: async (c) => {
      await parseBody(c, upsertColumnPolicySchema);
      return ok(c, await service.upsertPolicy(currentActor(c), param(c, "id"), param(c, "table"), param(c, "column")));
    },
    removePolicy: async (c) => {
      await service.removePolicy(currentActor(c), param(c, "id"), param(c, "table"), param(c, "column"));
      return c.body(null, 204);
    },
    fixture: async (c) => {
      const body = await parseBody(c, fixtureRequestSchema);
      return ok(c, await service.fixture(currentActor(c), param(c, "id"), body.table));
    },
  };
}
