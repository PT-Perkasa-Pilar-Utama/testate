import type { Introspection, Settings } from "@testate/shared";

import { toConnectionConfig } from "../../lib/engines/connection.ts";
import { EngineError } from "../../lib/engines/index.ts";
import type { ConnectionRef, DbEngine, PageQuery } from "../../lib/engines/index.ts";
import { AppError, conflict, forbidden, notFound } from "../../lib/http/index.ts";
import { tableKey } from "../../lib/engines/index.ts";
import type { AdapterRecord } from "../adapters/adapters.repository.ts";
import { CONFIG_COLUMN, openSecrets } from "../adapters/adapters.secrets.ts";
import { toAppError } from "../checkouts/checkouts.restore.ts";
import type { RestoreDeps } from "../checkouts/checkouts.restore.ts";
import type { JobsService } from "../jobs/jobs.service.ts";
import type { ProjectsRepository } from "../projects/projects.repository.ts";
import { createEditing } from "./data.editing.ts";
import { maskRows } from "./data.masks.ts";
import type { PoliciesRepository } from "./data.policies.ts";
import { createQueryRunner } from "./data.query.ts";
import type { QueryDeps } from "./data.query.ts";
import type { DataRepository, HistoryFilter, SavedQueryRecord } from "./data.repository.ts";
import { createWriteSessions } from "./data.sessions.ts";
import type { DataService } from "./data.contract.ts";

export type { DataService, SavedQueryInput } from "./data.contract.ts";

/**
 * Rows per round trip during an export, not a cap: the loop follows the cursor to the end either
 * way. `limit` overrides it, which is how a test forces more than one page out of a small table.
 */
const EXPORT_PAGE_ROWS = 1000;
import type { SessionDeps } from "./data.sessions.ts";

export type DataDeps = RestoreDeps & {
  repo: DataRepository;
  policies: PoliciesRepository;
  projects: Pick<ProjectsRepository, "byId" | "setHead" | "usedBytes">;
  jobs: Pick<JobsService, "enqueue" | "wait">;
  settings: { get(): Promise<Settings> };
  audit: SessionDeps["audit"];
  now: () => Date;
};

/** `schema.table` or `table`; the engine resolves the default schema. */
export function parseTableRef(table: string): { schema: string | null; name: string } {
  const dot = table.indexOf(".");
  return dot === -1
    ? { schema: null, name: table }
    : { schema: table.slice(0, dot), name: table.slice(dot + 1) };
}

export function createDataService(deps: DataDeps): DataService {
  const { repo } = deps;
  const adapterOf = (adapterId: string): AdapterRecord => {
    const adapter = deps.adapters.byId(adapterId);
    if (adapter === null) throw notFound("adapter");
    if (adapter.kind !== "database") {
      throw new AppError("ENGINE_UNSUPPORTED", "this adapter has no database engine", {
        reason: "kind",
      });
    }
    return adapter;
  };
  /** Decrypted config plus engine; the config never leaves this closure (12 §12.8). */
  const connect = async (
    adapter: AdapterRecord
  ): Promise<{ engine: DbEngine; conn: ConnectionRef }> => {
    const secrets = await openSecrets(deps.ring, adapter.id, CONFIG_COLUMN, adapter.config_sealed);
    const config = toConnectionConfig(adapter.engine, adapter.config, secrets);
    return {
      engine: deps.engines.require(adapter.engine),
      conn: { connectionId: adapter.id, config },
    };
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
  /** Live introspection with the adapter's policies laid over each column (06 §6.1). */
  const schemaOf = async (adapter: AdapterRecord): Promise<Introspection> => {
    const { engine, conn } = await connect(adapter);
    const excluded = adapter.excluded_tables.map(parseTableRef);
    const schema = await guarded(adapter, () => engine.introspect(conn, excluded));
    const policies = deps.policies.list(adapter.id);
    for (const table of schema.tables) {
      for (const column of table.columns) {
        const policy = policies.find(
          (item) => item.table === tableKey(table) && item.column === column.name
        );
        if (policy !== undefined)
          column.policy = { required_function: policy.required_function, mask: policy.mask };
        if (policy?.display === true) table.display_column = policy.column;
      }
    }
    return schema;
  };
  const queries = createQueryRunner({
    ...deps,
    adapterOf,
    connect,
    guarded,
    sessions,
    maskFor: (actor, adapter, rows) => maskRows(actor, rows, deps.policies.list(adapter.id)),
  });
  const editing = createEditing({ ...deps, adapterOf, connect, guarded, schemaOf, sessions });
  const savedOf = (adapter: AdapterRecord, id: string): SavedQueryRecord => {
    const query = repo.savedQuery(id);
    if (query === null || query.adapter_id !== adapter.id) throw notFound("saved query");
    return query;
  };

  return {
    async schema(adapterId) {
      return schemaOf(adapterOf(adapterId));
    },
    async rows(actor, adapterId, table, query = {}) {
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
      const masked = maskRows(
        actor,
        result.rows.map((row) => engine.decodeRow(row)),
        deps.policies.list(adapter.id, tableKey(page.table))
      );
      // ponytail: FK display values (`_display`) wait for a join in pageRows; the lookup endpoint covers forms.
      return {
        data: masked.rows,
        page: { next_cursor: result.nextCursor, limit: page.limit, kind: result.kind },
        columns: result.columns,
        masked_columns: masked.masked_columns,
      };
    },
    async *exportTable(actor, adapterId, table, query) {
      const adapter = adapterOf(adapterId);
      const { engine, conn } = await connect(adapter);
      const ref = parseTableRef(table);
      const policies = deps.policies.list(adapter.id, tableKey(ref));
      let cursor = query.cursor;
      // Bounded by the cursor, not by a row count: `pageRows` returns a null cursor at the end, and
      // a page that repeats its cursor would loop forever, so a repeat ends the export too.
      for (;;) {
        const page: PageQuery = {
          table: ref,
          limit: query.limit ?? EXPORT_PAGE_ROWS,
          order: query.order ?? "asc",
          filters: query.filters ?? [],
        };
        if (cursor !== undefined) page.cursor = cursor;
        if (query.sort !== undefined) page.sort = query.sort;
        const result = await guarded(adapter, () => engine.pageRows(conn, page));
        const masked = maskRows(
          actor,
          result.rows.map((row) => engine.decodeRow(row)),
          policies
        );
        yield { columns: result.columns, rows: masked.rows, nextCursor: result.nextCursor };
        if (result.nextCursor === null || result.nextCursor === cursor) return;
        cursor = result.nextCursor;
      }
    },
    lookup: (adapterId, table, column, q, limit) =>
      editing.lookup(adapterId, table, column, q, limit),
    startWriteSession: (actor, adapterId, foreignKeyChecks, meta) =>
      sessions.start(actor, adapterId, foreignKeyChecks, meta),
    setWriteSessionOptions: (actor, sessionId, foreignKeyChecks, meta) =>
      sessions.setForeignKeyChecks(actor, sessionId, foreignKeyChecks, meta),
    openWriteSession: (actor, adapterId, meta) => sessions.open(actor, adapterId, meta),
    endWriteSession: (actor, sessionId, meta) => sessions.end(actor, sessionId, meta),
    rowEdits: (actor, adapterId, table, sessionId, edits, meta) =>
      editing.rowEdits(actor, adapterId, table, sessionId, edits, meta),
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
    policies: (adapterId, table) => editing.policies(adapterId, table),
    upsertPolicy: (actor, adapterId, table, column, body, meta) =>
      editing.upsertPolicy(actor, adapterId, table, column, body, meta),
    removePolicy: (actor, adapterId, table, column, meta) =>
      editing.removePolicy(actor, adapterId, table, column, meta),
    setPolicyLock: (actor, adapterId, table, column, locked, meta) =>
      editing.setPolicyLock(actor, adapterId, table, column, locked, meta),
    fixture: (actor, adapterId, request, meta) => editing.fixture(actor, adapterId, request, meta),
  };
}

export type { QueryDeps };
