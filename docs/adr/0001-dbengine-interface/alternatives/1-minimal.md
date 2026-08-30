# `DbEngine`

Three entry points: `connect`, and the two verbs a session exposes, `read` and `write`. `cancel` and `close` are lifecycle plumbing, not design surface. No caller reasons about them; they just call them.

## 1. Interface

```ts
// apps/api/src/lib/engines/types.ts

export interface DbEngine {
  connect(config: EngineConfig, opts: ConnectOptions, event: WideEvent): Promise<EngineSession>;
}

interface SqlConfig { host: string; port: number; database: string; user: string; password: string; ssl?: SslMode }
export type SslMode = "disable" | "prefer" | "require" | "verify-ca" | "verify-full";

export type EngineConfig =
  | (SqlConfig & { engine: "postgres"; schemas?: string[] })
  | (SqlConfig & { engine: "mysql" | "mariadb" })
  | { engine: "mongodb"; uri: string; database: string; readCredential?: { user: string; password: string } };

export interface ConnectOptions {
  mode: "read" | "write";
  consistency?: "snapshot";
  tag: string;
}

export interface EngineSession {
  readonly engine: "postgres" | "mysql" | "mariadb" | "mongodb";
  readonly readOnlyEnforcement: "transaction" | "credential" | "filter" | "none";

  read(spec: DescribeSpec, event: WideEvent): Promise<SchemaDescriptor>;
  read(spec: ScanSpec, event: WideEvent): ScanResult;
  read(spec: QuerySpec & { mode: "read" }, event: WideEvent): Promise<QueryResult>;
  read(spec: RunningSpec, event: WideEvent): Promise<RunningOp[]>;

  write(spec: RowsSpec, event: WideEvent): Promise<WriteResult>;
  write(spec: DeleteSpec, event: WideEvent): Promise<WriteResult>;
  write(spec: QuerySpec & { mode: "write" }, event: WideEvent): Promise<QueryResult>;
  write(spec: RestoreSpec, event: WideEvent): RestoreResult;
  write(spec: ResetCountersSpec, event: WideEvent): Promise<CounterResetResult>;

  cancel(opId: string, event: WideEvent): Promise<void>;
  close(event: WideEvent): Promise<void>;
}
```

Read specs, one union, four shapes. `describe` folds probe, introspect, and fingerprint into one catalog walk. `scan` is a structured, engine-built read defaulting to primary-key order (row-hash when a table has none). Grid pages, snapshot's per-table stream, and diff's live-table stream are all this one call. `query` is the only place caller text enters the port.

```ts
export interface DescribeSpec { kind: "describe" }

export interface ScanSpec {
  kind: "scan";
  table: TableRef;
  order?: "primary-key" | { column: string; dir: "asc" | "desc" };
  filter?: FilterExpr;   // grid only
  cursor?: string;
  pageSize?: number;
  signal?: AbortSignal;
}
export type ScanResult = AsyncIterable<RowChunk> & { cursor(): string | null };
export interface RowChunk { rows: JsonRow[]; bytes: number }
export type JsonRow = Record<string, unknown>;

export interface QuerySpec {
  kind: "query";
  mode: "read" | "write";
  statement: string;   // SQL text, or a Mongo op name
  args?: unknown;        // bind params, or the Mongo body
  rowCap?: number;       // default 500, max 5000
  byteBudget?: number;
  timeBudgetMs?: number; // default 30s, max 300s
  signal?: AbortSignal;
}
export interface QueryResult { rows?: JsonRow[]; rowsAffected?: number; lastInsertId?: string; truncated: boolean; durationMs: number }

export interface RunningSpec { kind: "running" }
export interface RunningOp { id: string; tag: string; mode: "read" | "write"; startedAt: string; durationMs: number }
```

Write specs, one union, five shapes. `rows` covers import's append/upsert/replace and inline edit's insert/update as a one-row batch. `restore` is the same empty-then-insert idea (`rows` with `mode: "replace"`), generalized to a dependency-ordered table set with its own strategy, locking, and counter reset.

```ts
export interface RowsSpec {
  kind: "rows";
  table: TableRef;
  mode: "insert" | "upsert" | "replace";
  keyColumns?: string[];                    // required for upsert
  rows: JsonRow[] | AsyncIterable<JsonRow>;
  signal?: AbortSignal;
}
export interface DeleteSpec { kind: "delete"; table: TableRef; key: JsonRow }
export interface WriteResult {
  inserted: number; updated: number; deleted: number; skipped: number; failed: number;
  rejected: { row: JsonRow; reason: string }[];   // feeds the import module's re-importable CSV
  warnings: EngineWarning[];
}

export interface RestoreSpec {
  kind: "restore";
  tables: TableRef[];                                     // caller-resolved
  source: (table: TableRef) => AsyncIterable<RowChunk>;    // e.g. decompressed blob chunks
  lockTimeoutMs?: number;                                  // default 60_000
  signal?: AbortSignal;
}
export type RestoreResult = AsyncIterable<RestoreProgress> & { result(): Promise<RestoreOutcome> };
export interface RestoreProgress { table: string; rowsWritten: number }
export interface RestoreOutcome { tables: { table: string; rows: number; strategy: string }[]; countersReset: CounterResetResult; warnings: EngineWarning[] }

export interface ResetCountersSpec { kind: "reset-counters"; tables?: TableRef[] }   // omit = repair the last restore
export interface CounterResetResult { ok: boolean; failed: string[] }

export interface TableRef { schema?: string; name: string }
export interface EngineWarning { table: string; column?: string; reason: string }
```

`SchemaDescriptor` (`engineVersion`, `privileges`, `capabilities`, `tableCount`, `sizeEstimateBytes`, `tables`, `unsupportedTypes`, `fingerprint`), `TableSchema`, and `FilterExpr` mirror PRD §4.2–§4.3 directly. Not reproduced here: they're data, not new interface.

```ts
export type EngineErrorCode =
  | "UNREACHABLE" | "AUTH_FAILED" | "VERSION_TOO_LOW" | "PRIVILEGE_MISSING"
  | "SCHEMA_DRIFT" | "CHECKOUT_BLOCKED" | "CANCELLED" | "LOCK_TIMEOUT" | "BATCH_FAILED";

export interface EngineErrorDetails {
  UNREACHABLE: { reason: "network" | "blocked_address" };
  AUTH_FAILED: Record<string, never>;
  VERSION_TOO_LOW: { engineVersion: string; minimumVersion: string; privileges: string[]; tableCount: number };
  PRIVILEGE_MISSING: { privilege: string };
  SCHEMA_DRIFT: { tables: string[]; columns: { table: string; column: string }[] };
  CHECKOUT_BLOCKED: { blockingSessions: { id: string; startedAt: string }[] };
  CANCELLED: Record<string, never>;
  LOCK_TIMEOUT: { table: string; waitedMs: number };
  BATCH_FAILED: { table: string; rowRange: [number, number] };
}

export class EngineError<C extends EngineErrorCode = EngineErrorCode> extends Error {
  constructor(readonly code: C, message: string, readonly details: EngineErrorDetails[C], readonly retriable: boolean) {
    super(message);
  }
}
```

These nine are what this port models and what callers branch on by name. A raw write query that hits a constraint violation, or any other unmodeled failure, rejects with the driver's own error (`SQL.PostgresError`, a MongoDB driver error). Read `.message`; don't invent a tenth code.

| Category | What a caller must know |
| --- | --- |
| Invariant | Every `JsonRow` is server-side JSON, never driver-decoded. Grid and snapshot share the path, so exotic types still display. |
| Invariant | Generated columns never appear in a write; identity columns are overridden. Views reject every write kind. |
| Invariant | `EngineConfig` is a connection record's decrypted credentials. They never appear in an `EngineError`, a `WideEvent`, or a `RunningOp`. |
| Ordering | `mode` and `consistency` are fixed at `connect()`: no session upgrades later. |
| Ordering | A snapshot-session cursor works only on that session (it may be a live server cursor); a plain session's cursor is a portable keyset value. |
| Ordering | `SCHEMA_DRIFT` is thrown by the caller, not the engine: checkouts calls `describe()`, compares `fingerprint` to the manifest, and raises it (using the port's own `EngineError` type) before ever calling `write(RestoreSpec)`. The engine does not re-diff. A schema change after that point shows as `BATCH_FAILED` instead. |
| Ordering | `VERSION_TOO_LOW` throws from `describe()`, not `connect()`. `details` carry what was probed, so a failed probe still shows something. |
| Error | `CANCELLED` comes from an aborted `signal` (cooperative, checked between batches/chunks) or a `cancel()` call from another session (stops the live statement inside the engine); one code either way. |
| Config | `tag` is required on `connect()` and is caller-chosen: a job's id for a job session, an acting user's id for an ad hoc query. A later `listRunning`/`cancel` call finds it again by passing the same `tag`. |
| Performance | Primary-key `scan` is O(page). Offset order (PK-less tables) is O(offset + page); deep grid pages degrade by design. |
| Performance | A snapshot session pins one connection for its life; never hold it across HTTP requests. MySQL/MariaDB atomic restore locks every restored table for the whole write phase. |

## 2. Usage

**Snapshot job** (states module), in one session with one `WideEvent` and no transaction code in the caller:

```ts
const engine = engines[record.engine];
const session = await engine.connect(record.decryptedConfig, { mode: "read", consistency: "snapshot", tag: job.id }, event);

try {
  const schema = await session.read({ kind: "describe" }, event);
  event.merge("op", { fingerprint: schema.fingerprint, warnings: schema.unsupportedTypes.length });

  for (const table of tablesToSnapshot(schema)) {
    const blob = openBlobWriter(table);
    for await (const chunk of session.read({ kind: "scan", table, order: "primary-key", pageSize: 5000 }, event)) {
      await blob.writeGzippedLines(chunk.rows);
    }
    await blob.close();
  }
} finally {
  await session.close(event);   // commits the repeatable-read transaction
}
```

The caller never issues `DECLARE`/`FETCH` or opens a transaction, and never knows Postgres and MySQL disagree on multi-table consistency. It picks tables and writes bytes.

**Query runner** (data module), including cancel from a second connection:

```ts
const engine = engines[record.engine];
const session = await engine.connect(record.decryptedConfig, { mode: body.mode, tag: actor.userId }, event);
try {
  return body.mode === "write"
    ? await session.write({ kind: "query", mode: "write", statement: body.sql, args: body.params, timeBudgetMs: 30_000 }, event)
    : await session.read({ kind: "query", mode: "read", statement: body.sql, args: body.params, rowCap: 500, timeBudgetMs: 30_000 }, event);
} finally {
  await session.close(event);
}

// a later, unrelated request, same user:
const admin = await engine.connect(record.decryptedConfig, { mode: "read", tag: actor.userId }, event);
try {
  const running = await admin.read({ kind: "running" }, event);
  await admin.cancel(running[0].id, event);   // a second connection, never the one running the query
} finally {
  await admin.close(event);
}
```

`body.mode` is a runtime value, so TypeScript can't pick the overload for you. The caller branches once: the one place this design asks a caller to think about which verb it is using.

## 3. What the implementation hides

- Which physical read mechanism runs: Postgres `DECLARE`/`FETCH` on a pinned connection, a keyset `WHERE pk > ?` loop for MySQL/MariaDB (no server cursor exists), a native sorted cursor for Mongo. `scan` picks one; the caller never sees it.
- Restore's dependency graph: FK-closure computation, `TRUNCATE`-vs-`DELETE` strategy selection, cycle detection, two-phase insert-then-update for nullable self-references, deferred-constraint toggling, trigger-disable gated on the probed privilege. `RestoreSpec` only takes a flat table list.
- The `tag`-to-native-identity lookup and the cancel path: a Postgres `CancelRequest` via `pg_stat_activity`, a MySQL `KILL QUERY` via `performance_schema`, a Mongo `killOp` via `currentOp`, all filtered by `tag` so one caller can't see or kill another's work.
- Batch sizing under MySQL's packet limit; chunk sizing tuned for gzip-friendly streaming, not caller-visible pagination.
- UTC session pinning and the choice behind `readOnlyEnforcement`, decided once at `connect()` and reported, not configured.
- Type encode/decode per engine (`to_jsonb`, `JSON_OBJECT` with bigint/decimal as strings, canonical Extended JSON with the 16 MB per-document check), and the netguard address check before any socket opens.

## 4. Dependency strategy and adapters

A plain `const engines: Record<"postgres" | "mysql" | "mariadb" | "mongodb", DbEngine>` in `lib/engines/index.ts` maps a connection record's `engine` field to the right one below: a lookup table, not an abstraction.

- **`PostgresEngine`**: Bun's `SQL`. `sql.reserve()` backs pinned snapshot/restore sessions, `sql.begin()` backs read-only/repeatable-read transactions, and `sql()` fragments build dynamic identifiers (tagged templates can't parametrize them). `DECLARE`/`FETCH` and `to_jsonb(t)::text` are raw SQL over the reserved connection, read with `.raw()` so Bun never re-decodes them. Bun has neither `COPY` nor cursor streaming; both are hand-built. Cancel opens a throwaway connection for `pg_cancel_backend`.
- **`MySqlEngine`**: the same Bun `SQL` client, `adapter: "mysql"`, one class serving MySQL and MariaDB with a few `mariadb`-only branches (`max_statement_time` vs `max_execution_time`, the consistent-snapshot clause). Keyset loop instead of a server cursor; `lastInsertId` from `result.lastInsertRowid`, since MySQL has no `RETURNING`.
- **`MongoEngine`**: the official `mongodb` driver, not Bun SQL. A `ClientSession` with `startTransaction({ readConcern: { level: "snapshot" } })` on a replica set backs `consistency: "snapshot"`; best effort, flagged in `SchemaDescriptor`, on a standalone server.
- **`MemoryEngine`**: the API-test fake. `Map`-backed tables behind the identical `EngineSession` contract, configurable capability flags so adapters-module tests can simulate a missing `TRUNCATE` grant, an injectable delay for exercising `CHECKOUT_BLOCKED` upstream. Used only for HTTP-layer tests, such as auth, envelope shape, job flow, and idempotency. Never for restore correctness.
- The docker-compose suite runs one contract suite against all three real engines through this exact interface (PRD §5): probe/strategy selection, introspect including partitions and unsupported types, consistent snapshot under concurrent writes, restore against an out-of-scope referencing table, drift, force restore, counter reset and repair, lock timeout, type round-trip, query limits and cancel, read-only enforcement. That suite is the real test; the fake never substitutes for it.
- Everything in §3 is private to each adapter and swappable without touching this interface. That's locality in practice: a MariaDB dialect quirk lands inside `MySqlEngine`, never in a caller.

## 5. Trade-offs

High leverage: `read(ScanSpec)` is one method behind grid paging, snapshot's per-table stream, and diff's live-table stream. Three callers, one contract, and none of them know whether the engine used a server cursor or a keyset loop. `read(DescribeSpec)` is one method behind the adapters-module connection test, the data-module grid header, imports-module dry-run validation, and the checkouts-module drift check. `write(RowsSpec)` needed no separate "inline edit" verb; a one-row upsert already covers it. A project or adapter deletion's "return to init" step is `write(RestoreSpec)` again, targeting the adapter's init state. Deletion needed no restore logic of its own.

Thin: `write(RestoreSpec)` is the heaviest variant sitting inside the same method as a one-row delete. A reader learning what `write` does must hold both scales at once: the type system keeps the fields apart, not the mental model. `QuerySpec.mode` is data, not a literal type, so the query runner needs one small `if` to choose `read` or `write`; a dedicated `query()` method would remove that at the cost of a fourth entry point. Refused. `QuerySpec.statement`/`args` covers two mental models in one shape: real SQL text with bind params for the SQL engines, an op name and a JSON body for Mongo. That's honest, but whoever writes the Mongo branch must already know the convention.

Refused outright: a caller-composed transaction spanning several `read`/`write` calls. Consistency scope is a `connect()`-time decision, not something assembled ad hoc, because the alternative lets a caller hold a reserved connection open indefinitely and starve the pool. Also refused: the underlying driver object (Bun's `SQL` client, `mongodb`'s `Db`), exposed "for convenience," because that deletes the seam the moment one caller reaches past it. And a change-stream or `LISTEN`/`NOTIFY` primitive: nothing in the PRD asks Testate to react to live changes, so it isn't here.
