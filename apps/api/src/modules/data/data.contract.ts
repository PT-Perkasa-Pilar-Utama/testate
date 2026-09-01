import type {
  Actor,
  ColumnPolicy,
  Fixture,
  Introspection,
  JsonObject,
  QueryRequest,
  QueryResult,
  RowsPage,
  WriteSession,
} from "@testate/shared";

import type { PageQuery } from "../../lib/engines/index.ts";
import type { RequestMeta } from "../../lib/http/auth.ts";
import type { PolicyBody, RowEditsResult } from "./data.editing.ts";
import type { ExportPage } from "./data.export.ts";
import type { FixtureRequest } from "./data.fixture.ts";
import type { RowEdit } from "./data.forms.ts";
import type { LookupRow } from "./data.lookup.ts";
import type { RunningQueryView } from "./data.query.ts";
import type { HistoryRow, SavedQueryRecord } from "./data.repository.ts";

export type SavedQueryInput = { name: string; body: JsonObject };

export type DataService = {
  schema(adapterId: string): Promise<Introspection>;
  rows(
    actor: Actor,
    adapterId: string,
    table: string,
    query?: Partial<PageQuery>
  ): Promise<RowsPage>;
  /**
   * Every row of one table, page by page, for a download. Same filters, sort and masks as `rows`;
   * a tester should not have to write SQL to get a table out.
   */
  exportTable(
    actor: Actor,
    adapterId: string,
    table: string,
    query: Partial<PageQuery>
  ): AsyncGenerator<ExportPage>;
  lookup(
    adapterId: string,
    table: string,
    column: string,
    q: string,
    limit: number
  ): Promise<LookupRow[]>;
  startWriteSession(
    actor: Actor,
    adapterId: string,
    foreignKeyChecks: boolean,
    meta: RequestMeta
  ): Promise<WriteSession>;
  /** This actor's live session on the adapter, started if there is none (23 §23.6). */
  openWriteSession(actor: Actor, adapterId: string, meta: RequestMeta): Promise<WriteSession>;
  setWriteSessionOptions(
    actor: Actor,
    sessionId: string,
    foreignKeyChecks: boolean,
    meta: RequestMeta
  ): Promise<WriteSession>;
  endWriteSession(actor: Actor, sessionId: string, meta: RequestMeta): Promise<void>;
  rowEdits(
    actor: Actor,
    adapterId: string,
    table: string,
    sessionId: string,
    edits: RowEdit[],
    meta: RequestMeta
  ): Promise<RowEditsResult>;
  query(actor: Actor, adapterId: string, request: QueryRequest): Promise<QueryResult>;
  runningQueries(adapterId: string): Promise<RunningQueryView[]>;
  cancelQuery(actor: Actor, adapterId: string, queryId: string): Promise<void>;
  savedQueries(adapterId: string): Promise<SavedQueryRecord[]>;
  createSavedQuery(
    actor: Actor,
    adapterId: string,
    input: SavedQueryInput
  ): Promise<SavedQueryRecord>;
  updateSavedQuery(
    adapterId: string,
    id: string,
    patch: Partial<SavedQueryInput>
  ): Promise<SavedQueryRecord>;
  removeSavedQuery(adapterId: string, id: string): Promise<void>;
  history(
    actor: Actor,
    adapterId: string,
    limit: number,
    mode?: "read" | "write"
  ): Promise<HistoryRow[]>;
  policies(adapterId: string, table?: string): Promise<ColumnPolicy[]>;
  upsertPolicy(
    actor: Actor,
    adapterId: string,
    table: string,
    column: string,
    body: PolicyBody,
    meta: RequestMeta
  ): Promise<ColumnPolicy>;
  removePolicy(
    actor: Actor,
    adapterId: string,
    table: string,
    column: string,
    meta: RequestMeta
  ): Promise<void>;
  setPolicyLock(
    actor: Actor,
    adapterId: string,
    table: string,
    column: string,
    locked: boolean,
    meta: RequestMeta
  ): Promise<ColumnPolicy>;
  fixture(
    actor: Actor,
    adapterId: string,
    request: FixtureRequest,
    meta: RequestMeta
  ): Promise<Fixture>;
};
