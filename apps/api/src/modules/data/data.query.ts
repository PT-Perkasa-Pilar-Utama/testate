import type { Actor, JsonObject, QueryRequest, QueryResult, Settings } from "@testate/shared";

import type { ConnectionRef, DbEngine, QueryOptions } from "../../lib/engines/index.ts";
import { AppError, forbidden } from "../../lib/http/index.ts";
import type { RequestMeta } from "../../lib/http/auth.ts";
import { sha256 } from "../../lib/password/index.ts";
import type { AdapterRecord } from "../adapters/adapters.repository.ts";
import type { DataRepository } from "./data.repository.ts";
import type { Masked } from "./data.masks.ts";
import type { WriteSessions } from "./data.sessions.ts";

export type RunningQueryView = {
  query_id: string;
  tag: string | null;
  actor: string;
  mode: "read" | "write";
  started_at: string;
  duration_ms: number;
};

export type QueryDeps = {
  repo: DataRepository;
  settings: { get(): Promise<Settings> };
  now: () => Date;
  adapterOf: (adapterId: string) => AdapterRecord;
  connect: (adapter: AdapterRecord) => Promise<{ engine: DbEngine; conn: ConnectionRef }>;
  guarded: <T>(adapter: AdapterRecord, work: () => Promise<T>) => Promise<T>;
  sessions: WriteSessions;
  maskFor: (actor: Actor, adapter: AdapterRecord, rows: JsonObject[]) => Masked;
};

export type QueryRunner = {
  run(actor: Actor, adapterId: string, request: QueryRequest): Promise<QueryResult>;
  running(adapterId: string): RunningQueryView[];
  ownerOf(queryId: string): string | null;
};

type Running = RunningQueryView & { adapterId: string; ownerId: string; startedMs: number };

/** Session checks first, then the caps from settings clamp the caller's budgets (06 §6.7). */
type Budgets = Pick<QueryOptions, "rowCap" | "byteBudget" | "timeBudgetMs">;

function budgetsOf(request: QueryRequest, limits: Settings["limits"]): Budgets {
  return {
    rowCap: Math.min(request.row_cap ?? limits.query_rows_default, limits.query_rows_max),
    byteBudget: request.byte_budget ?? limits.query_bytes,
    timeBudgetMs: Math.min(
      request.time_budget_ms ?? limits.query_timeout_ms,
      limits.query_timeout_max_ms
    ),
  };
}

/**
 * SQL queries on the engine port: read mode in a read-only transaction, write mode inside a write
 * session with a stash before the first write; every run lands in the caller's history.
 * The mongo dialect carries the operation as JSON text to a MongoDB adapter (06 §6.7).
 */
/** `mongo` carries an operation to a MongoDB adapter; `sql` goes to the SQL engines (06 §6.7). */
function assertDialect(adapter: AdapterRecord, request: QueryRequest): void {
  const wantsMongo = request.dialect === "mongo";
  if (!wantsMongo && (request.text ?? "").trim() === "")
    throw new AppError("VALIDATION_ERROR", "text is required", { field: "text" });
  if (
    wantsMongo !== (adapter.engine === "mongodb") ||
    (wantsMongo && request.mongo === undefined)
  ) {
    throw new AppError("ENGINE_UNSUPPORTED", "the dialect does not match the adapter's engine", {
      reason: "dialect",
    });
  }
}

export function createQueryRunner(deps: QueryDeps): QueryRunner {
  const running = new Map<string, Running>();
  const meta: RequestMeta = { ip: "", user_agent: "", request_id: null };

  const authorize = async (
    actor: Actor,
    adapter: AdapterRecord,
    request: QueryRequest
  ): Promise<void> => {
    assertDialect(adapter, request);
    if (request.mode !== "write") return;
    if (actor.role === "viewer" || actor.agent) throw forbidden("role");
    if (request.write_session_id === undefined) throw forbidden("write session required");
    const session = deps.sessions.require(request.write_session_id);
    if (session.adapter_id !== adapter.id || session.user_id !== actor.id)
      throw forbidden("not the session's owner");
    if (adapter.mode !== "sandbox") {
      throw new AppError("ADAPTER_READ_ONLY", `${adapter.name} is read-only`, {
        adapter_id: adapter.id,
      });
    }
    await deps.sessions.beforeWrite(session, actor, meta);
  };

  return {
    async run(actor, adapterId, request) {
      const adapter = deps.adapterOf(adapterId);
      await authorize(actor, adapter, request);
      const text =
        request.dialect === "mongo" ? JSON.stringify(request.mongo) : (request.text ?? "");
      const budgets = budgetsOf(request, (await deps.settings.get()).limits);
      const { engine, conn } = await deps.connect(adapter);
      const queryId = Bun.randomUUIDv7();
      const startedAt = deps.now();
      running.set(queryId, {
        query_id: queryId,
        tag: request.tag ?? null,
        actor: actor.label,
        mode: request.mode,
        started_at: startedAt.toISOString(),
        duration_ms: 0,
        adapterId: adapter.id,
        ownerId: actor.id,
        startedMs: Date.now(),
      });
      const history = {
        id: Bun.randomUUIDv7(),
        adapter_id: adapter.id,
        user_id: actor.kind === "user" ? actor.id : null,
        token_id: actor.kind === "token" ? actor.id : null,
        query_hash: sha256(text),
        query_text: text,
        mode: request.mode,
        created_at: startedAt.toISOString(),
      };
      try {
        const result = await deps.guarded(adapter, () =>
          engine.runQuery(conn, { text }, { mode: request.mode, queryId, ...budgets })
        );
        deps.repo.insertHistory({
          ...history,
          duration_ms: result.durationMs,
          row_count: result.rows.length,
          error: null,
        });
        // ponytail: masks match on column name across the adapter, since a query's tables are unknown.
        const masked = deps.maskFor(
          actor,
          adapter,
          result.rows.map((row) => engine.decodeRow(row))
        );
        return {
          query_id: queryId,
          columns: result.columns.map((name) => ({ name, type: "unknown" })),
          rows: masked.rows,
          rows_affected: result.rowsAffected,
          truncated: { rows: result.truncated, bytes: false, time: false },
          duration_ms: result.durationMs,
          read_only_enforcement: adapter.read_only_enforcement ?? "transaction",
          masked_columns: masked.masked_columns,
        };
      } catch (cause: unknown) {
        const message = cause instanceof Error ? cause.message : String(cause);
        deps.repo.insertHistory({
          ...history,
          duration_ms: Date.now() - startedAt.getTime(),
          row_count: null,
          error: message,
        });
        throw cause;
      } finally {
        running.delete(queryId);
      }
    },
    running(adapterId) {
      const now = Date.now();
      return [...running.values()]
        .filter((item) => item.adapterId === adapterId)
        .map(({ adapterId: _adapter, ownerId: _owner, startedMs, ...view }) => ({
          ...view,
          duration_ms: now - startedMs,
        }));
    },
    ownerOf(queryId) {
      return running.get(queryId)?.ownerId ?? null;
    },
  };
}
