import type {
  Actor,
  ColumnPolicy,
  Fixture,
  Introspection,
  QueryRequest,
  QueryResult,
  RowsPage,
  WriteSession,
} from "@testate/shared";

import { AppError, conflict, forbidden, notFound } from "../../lib/http/index.ts";
import { ADAPTER_ID, ADAPTER_MONGO_ID } from "../../lib/mock/fixtures.ts";
import {
  COLUMN_POLICY_MOCK,
  FIXTURE_MOCK,
  INTROSPECTION_MOCK,
  QUERY_RESULT_MOCK,
  ROWS_PAGE_MOCK,
  WRITE_SESSION_MOCK,
} from "./data.mock.ts";

export type DataService = {
  schema(adapterId: string): Promise<Introspection>;
  rows(adapterId: string, table: string): Promise<RowsPage>;
  lookup(adapterId: string, table: string, column: string): Promise<{ key: (string | number)[]; display: string }[]>;
  startWriteSession(actor: Actor, adapterId: string, foreignKeyChecks: boolean): Promise<WriteSession>;
  setWriteSessionOptions(sessionId: string, foreignKeyChecks: boolean): Promise<WriteSession>;
  endWriteSession(sessionId: string): Promise<void>;
  rowEdits(adapterId: string, table: string, sessionId: string, count: number): Promise<{ results: { index: number; kind: "insert"; pk: { id: string }; row: { id: string } }[]; stash_state_id: string }>;
  query(actor: Actor, adapterId: string, request: QueryRequest): Promise<QueryResult>;
  runningQueries(adapterId: string): Promise<{ query_id: string; tag: string | null; actor: string; mode: "read" | "write"; started_at: string; duration_ms: number }[]>;
  cancelQuery(adapterId: string, queryId: string): Promise<void>;
  policies(adapterId: string): Promise<ColumnPolicy[]>;
  upsertPolicy(actor: Actor, adapterId: string, table: string, column: string): Promise<ColumnPolicy>;
  removePolicy(actor: Actor, adapterId: string, table: string, column: string): Promise<void>;
  fixture(actor: Actor, adapterId: string, table: string): Promise<Fixture>;
};

const TABULAR = new Set([ADAPTER_ID]);
const KNOWN = new Set([ADAPTER_ID, ADAPTER_MONGO_ID]);

function requireTabular(adapterId: string): void {
  if (!KNOWN.has(adapterId)) throw notFound("adapter");
  if (!TABULAR.has(adapterId)) throw new AppError("ENGINE_UNSUPPORTED", "operation outside the adapter's tier", { reason: "tier" });
}

/** SCAFFOLD: mock schema, rows, and results for the orders-db adapter. The data card wires the engine port. */
export function createDataService(): DataService {
  return {
    async schema(adapterId) {
      if (!KNOWN.has(adapterId)) throw notFound("adapter");
      return adapterId === ADAPTER_MONGO_ID ? { ...INTROSPECTION_MOCK, tier: "document" } : INTROSPECTION_MOCK;
    },
    async rows(adapterId, table) {
      if (!KNOWN.has(adapterId)) throw notFound("adapter");
      if (table !== "public.orders") throw notFound("table");
      return ROWS_PAGE_MOCK;
    },
    async lookup(adapterId, table, column) {
      requireTabular(adapterId);
      if (table !== "public.orders" || column !== "customer_id") throw new AppError("VALIDATION_ERROR", "not a foreign key column");
      return [{ key: [5120], display: "Dina Putri" }];
    },
    async startWriteSession(actor, adapterId, foreignKeyChecks) {
      requireTabular(adapterId);
      if (actor.role === "viewer") throw forbidden("role");
      return { ...WRITE_SESSION_MOCK, foreign_key_checks: foreignKeyChecks, stash_state_id: null };
    },
    async setWriteSessionOptions(sessionId, foreignKeyChecks) {
      if (sessionId !== WRITE_SESSION_MOCK.id) throw notFound("write session");
      return { ...WRITE_SESSION_MOCK, foreign_key_checks: foreignKeyChecks };
    },
    async endWriteSession(sessionId) {
      if (sessionId !== WRITE_SESSION_MOCK.id) throw notFound("write session");
    },
    async rowEdits(adapterId, table, sessionId, count) {
      requireTabular(adapterId);
      if (sessionId !== WRITE_SESSION_MOCK.id) throw conflict("write session is closed");
      if (table !== "public.orders") throw notFound("table");
      const results = Array.from({ length: count }, (_, index) => ({ index, kind: "insert" as const, pk: { id: String(88214 + index) }, row: { id: String(88214 + index) } }));
      return { results, stash_state_id: WRITE_SESSION_MOCK.stash_state_id ?? "" };
    },
    async query(actor, adapterId, request) {
      if (!KNOWN.has(adapterId)) throw notFound("adapter");
      if (request.mode === "write" && actor.role === "viewer") throw forbidden("role");
      if (request.mode === "write" && request.write_session_id === undefined) throw forbidden("write session required");
      if (request.dialect === "mongo" && adapterId !== ADAPTER_MONGO_ID) throw new AppError("VALIDATION_ERROR", "mongo dialect needs a MongoDB adapter");
      return adapterId === ADAPTER_MONGO_ID ? { ...QUERY_RESULT_MOCK, read_only_enforcement: "filter" } : QUERY_RESULT_MOCK;
    },
    async runningQueries(adapterId) {
      if (!KNOWN.has(adapterId)) throw notFound("adapter");
      return [{ query_id: QUERY_RESULT_MOCK.query_id, tag: "actor:dina.qa", actor: "dina.qa", mode: "read", started_at: "2026-08-28T08:00:00.000Z", duration_ms: 41 }];
    },
    async cancelQuery(adapterId, queryId) {
      if (!KNOWN.has(adapterId)) throw notFound("adapter");
      if (queryId !== QUERY_RESULT_MOCK.query_id) throw notFound("query");
    },
    async policies(adapterId) {
      requireTabular(adapterId);
      return [COLUMN_POLICY_MOCK];
    },
    async upsertPolicy(actor, adapterId, table, column) {
      requireTabular(adapterId);
      if (table === COLUMN_POLICY_MOCK.table && column === COLUMN_POLICY_MOCK.column && actor.role !== "admin") {
        throw forbidden("policy is locked");
      }
      return { ...COLUMN_POLICY_MOCK, table, column, locked: false };
    },
    async removePolicy(actor, adapterId, table, column) {
      requireTabular(adapterId);
      if (table === COLUMN_POLICY_MOCK.table && column === COLUMN_POLICY_MOCK.column && actor.role !== "admin") {
        throw forbidden("policy is locked");
      }
    },
    async fixture(actor, adapterId, table) {
      if (!KNOWN.has(adapterId)) throw notFound("adapter");
      if (table !== "public.orders") throw notFound("row");
      return actor.role === "viewer" || actor.agent ? FIXTURE_MOCK : { ...FIXTURE_MOCK, masked_columns: [] };
    },
  };
}
