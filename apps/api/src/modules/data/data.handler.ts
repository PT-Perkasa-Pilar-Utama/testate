import {
  fixtureRequestSchema,
  queryRequestSchema,
  rowEditsSchema,
  upsertColumnPolicySchema,
} from "@testate/shared";
import * as v from "valibot";

import { currentActor } from "../../lib/http/auth.ts";
import { ok, okPage, param, parseBody, parseQuery } from "../../lib/http/index.ts";
import type { Handler } from "../../lib/http/index.ts";
import type { DataService } from "./data.service.ts";

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
  policies: Handler;
  upsertPolicy: Handler;
  removePolicy: Handler;
  fixture: Handler;
};

const lookupQuerySchema = v.object({ column: v.array(v.string()), q: v.optional(v.array(v.string())) });
const sessionBodySchema = v.object({ foreign_key_checks: v.optional(v.boolean(), true) });

export function createDataHandlers(service: DataService): DataHandlers {
  return {
    schema: async (c) => ok(c, await service.schema(param(c, "id"))),
    rows: async (c) => {
      const page = await service.rows(param(c, "id"), param(c, "table"));
      return c.json(page, { status: 200 });
    },
    lookup: async (c) => {
      const query = parseQuery(c, lookupQuerySchema);
      return ok(c, await service.lookup(param(c, "id"), param(c, "table"), query.column[0] ?? ""));
    },
    startWriteSession: async (c) => {
      const body = await parseBody(c, sessionBodySchema);
      return ok(c, await service.startWriteSession(currentActor(c), param(c, "id"), body.foreign_key_checks), 201);
    },
    setWriteSessionOptions: async (c) => {
      const body = await parseBody(c, sessionBodySchema);
      return ok(c, await service.setWriteSessionOptions(param(c, "sid"), body.foreign_key_checks));
    },
    endWriteSession: async (c) => {
      await service.endWriteSession(param(c, "sid"));
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
    queryExport: async (c) => {
      const body = await parseBody(c, v.object({ ...queryRequestSchema.entries, format: v.picklist(["csv", "json"]) }));
      const result = await service.query(currentActor(c), param(c, "id"), body);
      c.header("Content-Disposition", `attachment; filename="query-${result.query_id}.${body.format}"`);
      return c.text(body.format === "json" ? JSON.stringify(result.rows) : result.rows.map((row) => Object.values(row).join(",")).join("\n"));
    },
    runningQueries: async (c) => okPage(c, await service.runningQueries(param(c, "id")), null, 50),
    cancelQuery: async (c) => {
      await service.cancelQuery(param(c, "id"), param(c, "query_id"));
      return c.body(null, 204);
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
