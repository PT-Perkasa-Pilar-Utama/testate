import type {
  Actor,
  ColumnPolicy,
  Fixture,
  Introspection,
  JsonObject,
  QueryRequest,
  QueryResult,
  RowsPage,
  Settings,
  WriteSession,
} from "@testate/shared";

import { toConnectionConfig } from "../../lib/engines/connection.ts";
import { EngineError } from "../../lib/engines/index.ts";
import type { ConnectionRef, DbEngine, PageQuery } from "../../lib/engines/index.ts";
import { AppError, conflict, forbidden, notFound } from "../../lib/http/index.ts";
import type { RequestMeta } from "../../lib/http/auth.ts";
import type { AdapterRecord } from "../adapters/adapters.repository.ts";
import { CONFIG_COLUMN, openSecrets } from "../adapters/adapters.secrets.ts";
import { toAppError } from "../checkouts/checkouts.restore.ts";
import type { RestoreDeps } from "../checkouts/checkouts.restore.ts";
import type { JobsService } from "../jobs/jobs.service.ts";
import type { ProjectsRepository } from "../projects/projects.repository.ts";
import { COLUMN_POLICY_MOCK, FIXTURE_MOCK } from "./data.mock.ts";
import { createQueryRunner } from "./data.query.ts";
import type { QueryDeps, RunningQueryView } from "./data.query.ts";
import type { DataRepository, HistoryFilter, HistoryRow, SavedQueryRecord } from "./data.repository.ts";
import { createWriteSessions } from "./data.sessions.ts";
import type { SessionDeps } from "./data.sessions.ts";

export type SavedQueryInput = { name: string; body: JsonObject };

export type DataService = {
  schema(adapterId: string): Promise<Introspection>;
  rows(adapterId: string, table: string, query?: Partial<PageQuery>): Promise<RowsPage>;
  lookup(adapterId: string, table: string, column: string): Promise<{ key: (string | number)[]; display: string }[]>;
  startWriteSession(actor: Actor, adapterId: string, foreignKeyChecks: boolean, meta: RequestMeta): Promise<WriteSession>;
  setWriteSessionOptions(actor: Actor, sessionId: string, foreignKeyChecks: boolean, meta: RequestMeta): Promise<WriteSession>;
  endWriteSession(actor: Actor, sessionId: string, meta: RequestMeta): Promise<void>;
  rowEdits(adapterId: string, table: string, sessionId: string, count: number): Promise<{ results: { index: number; kind: "insert"; pk: { id: string }; row: { id: string } }[]; stash_state_id: string }>;
  query(actor: Actor, adapterId: string, request: QueryRequest): Promise<QueryResult>;
  runningQueries(adapterId: string): Promise<RunningQueryView[]>;
  cancelQuery(actor: Actor, adapterId: string, queryId: string): Promise<void>;
  savedQueries(adapterId: string): Promise<SavedQueryRecord[]>;
  createSavedQuery(actor: Actor, adapterId: string, input: SavedQueryInput): Promise<SavedQueryRecord>;
  updateSavedQuery(adapterId: string, id: string, patch: Partial<SavedQueryInput>): Promise<SavedQueryRecord>;
  removeSavedQuery(adapterId: string, id: string): Promise<void>;
  history(actor: Actor, adapterId: string, limit: number, mode?: "read" | "write"): Promise<HistoryRow[]>;
  policies(adapterId: string): Promise<ColumnPolicy[]>;
  upsertPolicy(actor: Actor, adapterId: string, table: string, column: string): Promise<ColumnPolicy>;
  removePolicy(actor: Actor, adapterId: string, table: string, column: string): Promise<void>;
  fixture(actor: Actor, adapterId: string, table: string): Promise<Fixture>;
};

export type DataDeps = RestoreDeps & {
  repo: DataRepository;
  projects: Pick<ProjectsRepository, "byId" | "setHead" | "usedBytes">;
  jobs: Pick<JobsService, "enqueue" | "wait">;
  settings: { get(): Promise<Settings> };
  audit: SessionDeps["audit"];
  now: () => Date;
};

/** `schema.table` or `table`; the engine resolves the default schema. */
export function parseTableRef(table: string): { schema: string | null; name: string } {
  const dot = table.indexOf(".");
  return dot === -1 ? { schema: null, name: table } : { schema: table.slice(0, dot), name: table.slice(dot + 1) };
}

function requireTabular(adapter: AdapterRecord): void {
  if (adapter.tier !== "tabular") {
    throw new AppError("ENGINE_UNSUPPORTED", "operation outside the adapter's tier", { reason: "tier" });
  }
}

export function createDataService(deps: DataDeps): DataService {
  const { repo } = deps;
  const adapterOf = (adapterId: string): AdapterRecord => {
    const adapter = deps.adapters.byId(adapterId);
    if (adapter === null) throw notFound("adapter");
    if (adapter.kind !== "database") {
      throw new AppError("ENGINE_UNSUPPORTED", "this adapter has no database engine", { reason: "kind" });
    }
    return adapter;
  };
  /** Decrypted config plus engine; the config never leaves this closure (12 §12.8). */
  const connect = async (adapter: AdapterRecord): Promise<{ engine: DbEngine; conn: ConnectionRef }> => {
    const secrets = await openSecrets(deps.ring, adapter.id, CONFIG_COLUMN, adapter.config_sealed);
    const config = toConnectionConfig(adapter.engine, adapter.config, secrets);
    return { engine: deps.engines.require(adapter.engine), conn: { connectionId: adapter.id, config } };
  };
  const guarded = async <T>(adapter: AdapterRecord, work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (cause: unknown) {
      if (cause instanceof EngineError && cause.details["reason"] !== undefined) {
        throw new AppError("VALIDATION_ERROR", cause.message, cause.details);
      }
      throw toAppError(cause, adapter.id);
    }
  };
  const sessions = createWriteSessions({ ...deps, adapterOf });
  const queries = createQueryRunner({ ...deps, adapterOf, connect, guarded, sessions });
  const savedOf = (adapter: AdapterRecord, id: string): SavedQueryRecord => {
    const query = repo.savedQuery(id);
    if (query === null || query.adapter_id !== adapter.id) throw notFound("saved query");
    return query;
  };

  return {
    async schema(adapterId) {
      const adapter = adapterOf(adapterId);
      const { engine, conn } = await connect(adapter);
      const excluded = adapter.excluded_tables.map(parseTableRef);
      return guarded(adapter, () => engine.introspect(conn, excluded));
    },
    async rows(adapterId, table, query = {}) {
      const adapter = adapterOf(adapterId);
      const { engine, conn } = await connect(adapter);
      const page: PageQuery = {
        table: parseTableRef(table),
        limit: query.limit ?? 100,
        order: query.order ?? "asc",
        filters: query.filters ?? [],
      };
      if (query.cursor !== undefined) page.cursor = query.cursor;
      if (query.sort !== undefined) page.sort = query.sort;
      const result = await guarded(adapter, () => engine.pageRows(conn, page));
      // SCAFFOLD: masks and FK display values arrive with the table-editing card (24 §24.3).
      return {
        data: result.rows.map((row) => engine.decodeRow(row)),
        page: { next_cursor: result.nextCursor, limit: page.limit, kind: result.kind },
        columns: result.columns,
        masked_columns: [],
      };
    },
    // SCAFFOLD: lookup, row edits, policies, and fixtures belong to the table-editing card (24).
    async lookup(adapterId, table, column) {
      requireTabular(adapterOf(adapterId));
      if (table !== "public.orders" || column !== "customer_id") {
        throw new AppError("VALIDATION_ERROR", "not a foreign key column");
      }
      return [{ key: [5120], display: "Dina Putri" }];
    },
    startWriteSession: (actor, adapterId, foreignKeyChecks, meta) =>
      sessions.start(actor, adapterId, foreignKeyChecks, meta),
    setWriteSessionOptions: (actor, sessionId, foreignKeyChecks, meta) =>
      sessions.setForeignKeyChecks(actor, sessionId, foreignKeyChecks, meta),
    endWriteSession: (actor, sessionId, meta) => sessions.end(actor, sessionId, meta),
    async rowEdits(adapterId, table, sessionId, count) {
      requireTabular(adapterOf(adapterId));
      const session = sessions.require(sessionId);
      if (table === "") throw notFound("table");
      const results = Array.from({ length: count }, (_, index) => ({
        index,
        kind: "insert" as const,
        pk: { id: String(88214 + index) },
        row: { id: String(88214 + index) },
      }));
      return { results, stash_state_id: session.stash_state_id ?? "" };
    },
    query: (actor, adapterId, request) => queries.run(actor, adapterId, request),
    async runningQueries(adapterId) {
      adapterOf(adapterId);
      return queries.running(adapterId);
    },
    async cancelQuery(actor, adapterId, queryId) {
      const adapter = adapterOf(adapterId);
      const { engine, conn } = await connect(adapter);
      const owner = queries.ownerOf(queryId);
      if (owner === null) throw notFound("query");
      if (owner !== actor.id && actor.role !== "admin") throw forbidden("not the query's owner");
      await guarded(adapter, () => engine.cancelQuery(conn, queryId));
    },
    async savedQueries(adapterId) {
      return repo.savedQueries(adapterOf(adapterId).id);
    },
    async createSavedQuery(actor, adapterId, input) {
      const adapter = adapterOf(adapterId);
      if (repo.savedQueryByName(adapter.id, input.name) !== null) {
        throw conflict("saved query name is taken", { name: input.name });
      }
      const at = deps.now().toISOString();
      const query: SavedQueryRecord = {
        id: Bun.randomUUIDv7(),
        adapter_id: adapter.id,
        name: input.name,
        body: input.body,
        created_by: actor.id,
        created_at: at,
        updated_at: at,
      };
      repo.insertSavedQuery(query);
      return query;
    },
    async updateSavedQuery(adapterId, id, patch) {
      const adapter = adapterOf(adapterId);
      const current = savedOf(adapter, id);
      if (patch.name !== undefined && patch.name.toLowerCase() !== current.name.toLowerCase()) {
        if (repo.savedQueryByName(adapter.id, patch.name) !== null) {
          throw conflict("saved query name is taken", { name: patch.name });
        }
      }
      repo.updateSavedQuery(current.id, patch, deps.now().toISOString());
      return savedOf(adapter, id);
    },
    async removeSavedQuery(adapterId, id) {
      repo.removeSavedQuery(savedOf(adapterOf(adapterId), id).id);
    },
    async history(actor, adapterId, limit, mode) {
      const adapter = adapterOf(adapterId);
      const filter: HistoryFilter = { limit, userId: actor.role === "admin" ? null : actor.id };
      if (mode !== undefined) filter.mode = mode;
      return repo.history(adapter.id, filter);
    },
    async policies(adapterId) {
      requireTabular(adapterOf(adapterId));
      return [COLUMN_POLICY_MOCK];
    },
    async upsertPolicy(actor, adapterId, table, column) {
      requireTabular(adapterOf(adapterId));
      if (table === COLUMN_POLICY_MOCK.table && column === COLUMN_POLICY_MOCK.column && actor.role !== "admin") {
        throw forbidden("policy is locked");
      }
      return { ...COLUMN_POLICY_MOCK, table, column, locked: false };
    },
    async removePolicy(actor, adapterId, table, column) {
      requireTabular(adapterOf(adapterId));
      if (table === COLUMN_POLICY_MOCK.table && column === COLUMN_POLICY_MOCK.column && actor.role !== "admin") {
        throw forbidden("policy is locked");
      }
    },
    async fixture(actor, adapterId, table) {
      adapterOf(adapterId);
      if (table === "") throw notFound("row");
      return actor.role === "viewer" || actor.agent ? FIXTURE_MOCK : { ...FIXTURE_MOCK, masked_columns: [] };
    },
  };
}

export type { QueryDeps };
