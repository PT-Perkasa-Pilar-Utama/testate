import { Hono } from "hono";
import {
  columnPolicySchema,
  fixtureSchema,
  introspectionSchema,
  lookupResultSchema,
  queryHistoryRowSchema,
  queryResultSchema,
  rowEditsResultSchema,
  runningQuerySchema,
  savedQuerySchema,
  writeSessionSchema,
} from "@testate/shared";
import * as v from "valibot";

import { requireRole } from "../../lib/http/auth.ts";
import { describe } from "../../lib/openapi.ts";
import type { DataHandlers } from "./data.handler.ts";

const A = "/projects/:slug/adapters/:id";

export function createDataRouter(h: DataHandlers): Hono {
  const router = new Hono();
  router.get(
    `${A}/schema`,
    requireRole("viewer"),
    describe("data", "Introspection", introspectionSchema),
    h.schema
  );
  router.get(
    `${A}/tables/:table/rows`,
    requireRole("viewer"),
    describe("data", "Grid page", v.unknown()),
    h.rows
  );
  router.get(
    `${A}/tables/:table/lookup`,
    requireRole("viewer"),
    describe("data", "FK lookup", v.array(lookupResultSchema)),
    h.lookup
  );
  router.post(
    `${A}/write-sessions`,
    requireRole("qa"),
    describe("data", "Start a write session", writeSessionSchema, 201),
    h.startWriteSession
  );
  router.patch(
    `${A}/write-sessions/:sid`,
    requireRole("qa"),
    describe("data", "Toggle foreign-key checks", writeSessionSchema),
    h.setWriteSessionOptions
  );
  router.delete(
    `${A}/write-sessions/:sid`,
    requireRole("qa"),
    describe("data", "End a write session", v.undefined(), 204),
    h.endWriteSession
  );
  router.post(
    `${A}/tables/:table/row-edits`,
    requireRole("qa"),
    describe("data", "Insert, update, delete rows", rowEditsResultSchema),
    h.rowEdits
  );
  router.post(
    `${A}/query`,
    requireRole("viewer"),
    describe("data", "Run a query", queryResultSchema),
    h.query
  );
  router.post(
    `${A}/query/export`,
    requireRole("viewer"),
    describe("data", "Export a query result", v.unknown()),
    h.queryExport
  );
  router.get(
    `${A}/queries`,
    requireRole("viewer"),
    describe("data", "Running queries", v.array(runningQuerySchema)),
    h.runningQueries
  );
  router.delete(
    `${A}/queries/:query_id`,
    requireRole("viewer"),
    describe("data", "Cancel a query", v.undefined(), 204),
    h.cancelQuery
  );
  router.get(
    `${A}/saved-queries`,
    requireRole("viewer"),
    describe("data", "Saved queries", v.array(savedQuerySchema)),
    h.savedQueries
  );
  router.post(
    `${A}/saved-queries`,
    requireRole("qa"),
    describe("data", "Save a query", savedQuerySchema, 201),
    h.createSavedQuery
  );
  router.patch(
    `${A}/saved-queries/:qid`,
    requireRole("qa"),
    describe("data", "Update a saved query", savedQuerySchema),
    h.updateSavedQuery
  );
  router.delete(
    `${A}/saved-queries/:qid`,
    requireRole("qa"),
    describe("data", "Delete a saved query", v.undefined(), 204),
    h.removeSavedQuery
  );
  router.get(
    `${A}/query-history`,
    requireRole("viewer"),
    describe("data", "Query history", v.array(queryHistoryRowSchema)),
    h.history
  );
  router.get(
    `${A}/policies`,
    requireRole("viewer"),
    describe("data", "Column policies", v.array(columnPolicySchema)),
    h.policies
  );
  router.put(
    `${A}/policies/:table/:column`,
    requireRole("qa"),
    describe("data", "Upsert a column policy", columnPolicySchema),
    h.upsertPolicy
  );
  router.delete(
    `${A}/policies/:table/:column`,
    requireRole("qa"),
    describe("data", "Remove a column policy", v.undefined(), 204),
    h.removePolicy
  );
  router.post(
    `${A}/policies/:table/:column/lock`,
    requireRole("admin"),
    describe("data", "Lock a policy", columnPolicySchema),
    h.lockPolicy
  );
  router.post(
    `${A}/policies/:table/:column/unlock`,
    requireRole("admin"),
    describe("data", "Unlock a policy", columnPolicySchema),
    h.unlockPolicy
  );
  router.post(
    `${A}/fixture`,
    requireRole("viewer"),
    describe("data", "Extract a fixture", fixtureSchema),
    h.fixture
  );
  return router;
}
