# DbEngine

The seam is one shape learned once and reused everywhere: rows travel as opaque server-serialized text, and every operation that does real work returns the same stream-plus-summary container. Four callers, one mental model.

## 1. Interface

```typescript
// ── Connection config: one union member per engine. A new engine adds a
// member here, never a new optional field on an existing one.
type ConnectionConfig = PostgresConfig | MysqlConfig | MongoConfig;

interface PostgresConfig {
  readonly engine: "postgres";
  readonly host: string; readonly port: number; readonly database: string;
  readonly user: string; readonly password: string;
  readonly ssl?: SslMode;
  readonly schemas?: readonly string[];        // US26: multi-schema coverage
}
interface MysqlConfig {
  readonly engine: "mysql" | "mariadb";        // one adapter, dialect branches inside
  readonly host: string; readonly port: number; readonly database: string;
  readonly user: string; readonly password: string;
  readonly ssl?: SslMode;
}
interface MongoConfig {
  readonly engine: "mongodb";
  readonly connectionString: string;
  readonly readOnlyConnectionString?: string;  // US23
}
type SslMode = "disable" | "prefer" | "require" | "verify-ca" | "verify-full";

// ── Cross-cutting plumbing. Every field is infrastructure a caller threads
// through without reading it. The day a field forces a caller to branch on
// it to call a method correctly, it leaves OpContext for a real parameter.
interface OpContext {
  readonly event: WideEvent;      // lib/logger; every method fills event's engine section
  readonly signal?: AbortSignal;  // cooperative cancel; adapters also cancel the live driver call
}

// ── The one streaming shape. readTable, restore, write, and runQuery all
// return this. Breaking `for await` early still runs adapter cleanup
// (cursor close, rollback or commit, connection release) before `summary`
// settles: `summary` resolves `completed:false` on a clean early stop,
// rejects CancelledError if `signal` fired, rejects the causing error
// otherwise.
interface EngineStream<TItem, TSummary extends { completed: boolean }> {
  readonly items: AsyncIterable<TItem>;
  readonly summary: Promise<TSummary>;
}

// ── Rows cross the seam as opaque, server-serialized JSON text, never
// parsed back into JS values inside this module. This one rule is why
// bigints, decimals, timestamptz, composite arrays, and Extended JSON
// round-trip: nothing here re-encodes a value it did not itself ask the
// server to produce.
type RowText = string & { readonly __rowText: unique symbol };

interface RowChunk { readonly rows: readonly RowText[]; readonly lastKey: SortKey; }
type SortKey =
  | { readonly by: "primary-key"; readonly value: readonly JsonScalar[] }
  | { readonly by: "row-hash"; readonly value: string };
type JsonScalar = string | number | boolean | null;

interface ResultColumn { readonly name: string; readonly dataType: string; }
interface ColumnMeta extends ResultColumn {
  readonly nullable: boolean; readonly hasDefault: boolean;
  readonly generated: boolean; readonly identity: boolean;
}
interface TableRef { readonly schema?: string; readonly name: string; }

// ── The port.
interface DbEngine<C extends ConnectionConfig = ConnectionConfig> {
  readonly kind: C["engine"];

  probe(config: C, ctx: OpContext): Promise<ProbeResult>;
  introspect(config: C, opts: IntrospectOptions, ctx: OpContext): Promise<IntrospectionResult>;

  openSnapshotSession(config: C, ctx: OpContext): Promise<SnapshotSession>;

  restore(config: C, plan: RestorePlan, ctx: OpContext): EngineStream<RestoreProgress, RestoreSummary>;
  resetCounters(config: C, tables: readonly TableRef[], ctx: OpContext): Promise<CounterResetResult[]>;
  terminateSessions(config: C, sessions: readonly EngineSessionId[], ctx: OpContext): Promise<void>;

  runQuery(config: C, request: QueryRequest, ctx: OpContext): QueryStream;
  listRunningQueries(config: C, ctx: OpContext): Promise<RunningQuery[]>;
  cancelQuery(config: C, queryId: EngineQueryId, ctx: OpContext): Promise<void>;

  write(config: C, table: TableRef, request: WriteRequest, ctx: OpContext): EngineStream<WriteProgress, WriteSummary>;
  editRow(config: C, table: TableRef, edit: RowEdit, ctx: OpContext): Promise<RowText | null>;

  decodeRow(row: RowText, columns: readonly ResultColumn[]): DisplayRow;  // pure, sync, no ctx
}

interface SnapshotSession {
  readonly consistency: "repeatable-read-cursor" | "consistent-snapshot-keyset" | "replica-set-snapshot" | "best-effort";
  introspect(ctx: OpContext): Promise<IntrospectionResult>;   // same point-in-time view readTable uses
  readTable(table: TableRef, ctx: OpContext, hints?: PerformanceHints): EngineStream<RowChunk, ReadSummary>;
  close(): Promise<void>;
}
interface ReadSummary { readonly completed: boolean; readonly rowCount: number; readonly byteCount: number; readonly sortedBy: "primary-key" | "row-hash"; }
interface PerformanceHints { readonly chunkRows?: number; readonly batchSize?: number; }
```

```typescript
interface ProbeResult {
  readonly version: string;
  readonly minVersionOk: boolean; readonly minVersionRequired: string;
  readonly capabilities: Capabilities;
  readonly strategy: RestoreStrategy;            // derived; a caller reads it, never builds one
  readonly readOnlyEnforcement: "session" | "role" | "filter";
  readonly tableCount: number; readonly sizeEstimateBytes: number;
  readonly engineSpecific?: Readonly<Record<string, unknown>>;  // UI hints only, never a branch condition
}
interface Capabilities {
  readonly canDisableTriggers: boolean; readonly canSetReplicationRole: boolean;
  readonly canTruncate: boolean; readonly canTerminateSessions: boolean;
  readonly supportsTransactionalRestore: boolean; readonly supportsDeferrableConstraints: boolean;
}
// Orthogonal axes, not a per-engine enum. A fifth engine is a new
// combination of these fields, never a new switch case at a call site.
interface RestoreStrategy {
  readonly emptyMode: "truncate" | "delete" | "delete-many";
  readonly foreignKeyHandling: "session-disable" | "dependency-order" | "not-applicable";
  readonly transactional: boolean; readonly triggerDisable: boolean;
  readonly locking: "row" | "table" | "per-operation";
}

interface IntrospectOptions { readonly excludeTables?: readonly TableRef[]; }
interface IntrospectionResult {
  readonly tables: readonly TableInfo[];
  readonly views: readonly TableRef[];                        // listed, never restored
  readonly unsupportedColumns: readonly UnsupportedColumn[];   // data, never thrown
}
interface TableInfo {
  readonly table: TableRef; readonly columns: readonly ColumnMeta[];
  readonly primaryKey: readonly string[] | null;                // null: sort by row hash
  readonly foreignKeys: readonly ForeignKey[];
  readonly uniqueConstraints: readonly (readonly string[])[]; readonly checkConstraints: readonly string[];
  readonly kind: "table" | "partition-parent" | "inheritance-child";
  readonly collectionOptions?: Readonly<Record<string, unknown>>;   // Mongo only
}
interface ForeignKey { readonly columns: readonly string[]; readonly refTable: TableRef; readonly refColumns: readonly string[]; readonly nullable: boolean; }
interface UnsupportedColumn { readonly table: TableRef; readonly column: string; readonly reason: string; }

interface RestorePlan {
  readonly strategy: RestoreStrategy;             // echoed from probe(), not re-derived
  readonly tables: readonly TableRestoreSpec[];    // already dependency-ordered by the caller
  readonly lockTimeoutMs: number;
  readonly disableTriggers: boolean;               // true only if capabilities allowed it; an unbreakable FK cycle needs this to succeed at all
}
interface TableRestoreSpec {
  readonly table: TableRef;
  readonly columns: readonly string[];             // post force-intersection; adapter still re-filters generated/identity
  readonly openRows: () => AsyncIterable<RowText>;  // lazy: opened one table at a time, in order
}
type RestoreProgress =
  | { readonly phase: "table-started"; readonly table: TableRef }
  | { readonly phase: "table-progress"; readonly table: TableRef; readonly rowsWritten: number }
  | { readonly phase: "table-completed"; readonly table: TableRef; readonly rowsWritten: number }
  | { readonly phase: "counters-reset"; readonly table: TableRef; readonly ok: boolean };
interface RestoreSummary {
  readonly completed: boolean; readonly tablesRestored: readonly TableRef[];
  readonly batches: number; readonly lockWaitMs: number;
  readonly countersReset: number; readonly warnings: readonly string[];
}
interface CounterResetResult { readonly table: TableRef; readonly ok: boolean; readonly error?: string; }

type QueryRequest = {
  readonly mode: "read" | "write";
  readonly rowCap: number; readonly byteBudgetBytes: number; readonly timeBudgetMs: number;
  readonly tag?: string;                           // caller-chosen; echoed in RunningQuery for correlation
} & ({ readonly dialect: "sql"; readonly text: string } | { readonly dialect: "mongo"; readonly operation: MongoOperation });
type MongoOperation =                               // shape only; content validated at the HTTP boundary (valibot)
  | { readonly op: "find"; readonly collection: string; readonly filter: unknown; readonly sort?: unknown; readonly projection?: unknown; readonly limit?: number; readonly skip?: number }
  | { readonly op: "aggregate"; readonly collection: string; readonly pipeline: readonly unknown[] }
  | { readonly op: "updateMany"; readonly collection: string; readonly filter: unknown; readonly update: unknown }
  | { readonly op: "deleteMany"; readonly collection: string; readonly filter: unknown }
  | { readonly op: "insertMany"; readonly collection: string; readonly documents: readonly unknown[] };

interface QueryStream extends EngineStream<RowChunk, QuerySummary> {
  readonly queryId: Promise<EngineQueryId>;         // resolves before rows finish — cancel needs it early
  readonly columns: Promise<readonly ResultColumn[]>;
}
interface QuerySummary {
  readonly completed: boolean; readonly rowsReturned: number; readonly rowsAffected: number | null;
  readonly truncatedByRowCap: boolean; readonly truncatedByByteBudget: boolean; readonly timedOut: boolean;
}
type EngineQueryId = string & { readonly __queryId: unique symbol };
type EngineSessionId = string & { readonly __sessionId: unique symbol };
interface RunningQuery { readonly id: EngineQueryId; readonly tag?: string; readonly sqlPreview?: string; readonly startedAt: Date; readonly durationMs: number; readonly mode: "read" | "write"; }
interface BlockingSession { readonly id: EngineSessionId; readonly durationMs: number; readonly terminable: boolean; }

type WriteOp =
  | { readonly kind: "insert"; readonly row: RowText }
  | { readonly kind: "upsert"; readonly keyColumns: readonly string[]; readonly row: RowText }
  | { readonly kind: "delete"; readonly primaryKey: Readonly<Record<string, JsonScalar>> };
interface WriteRequest { readonly mode: "append" | "replace"; readonly ops: readonly WriteOp[]; readonly transactional: boolean; readonly hints?: PerformanceHints; }
interface WriteProgress { readonly rowsWritten: number; }
interface WriteSummary { readonly completed: boolean; readonly inserted: number; readonly updated: number; readonly skipped: number; readonly failed: number; readonly ranTransactionally: boolean; }

type RowEdit =
  | { readonly kind: "insert"; readonly row: RowText }
  | { readonly kind: "update"; readonly primaryKey: Readonly<Record<string, JsonScalar>>; readonly row: RowText }
  | { readonly kind: "delete"; readonly primaryKey: Readonly<Record<string, JsonScalar>> };

interface DisplayRow { readonly [column: string]: DisplayValue; }
type DisplayValue =
  | { readonly kind: "scalar"; readonly value: JsonScalar }
  | { readonly kind: "precise-text"; readonly value: string }   // bigint/decimal — never a JS number
  | { readonly kind: "json"; readonly value: unknown }
  | { readonly kind: "unsupported"; readonly typeName: string };

// ── Errors: a closed hierarchy. Unsupported types are never thrown — see
// IntrospectionResult.unsupportedColumns and every summary's `warnings`.
abstract class EngineError extends Error { abstract readonly code: string; }
class UnreachableError extends EngineError { readonly code = "ENGINE_UNREACHABLE"; }
class AuthenticationFailedError extends EngineError { readonly code = "ENGINE_AUTH_FAILED"; }
class VersionUnsupportedError extends EngineError {
  readonly code = "ENGINE_VERSION_UNSUPPORTED";
  constructor(readonly version: string, readonly minimumRequired: string) { super(`engine ${version} below minimum ${minimumRequired}`); }
}
class PrivilegeMissingError extends EngineError {
  readonly code = "ENGINE_PRIVILEGE_MISSING";
  constructor(readonly privilege: string, readonly operation: string) { super(`${operation} needs ${privilege}`); }
}
class SchemaDriftError extends EngineError {
  readonly code = "ENGINE_SCHEMA_DRIFT";
  constructor(readonly tables: readonly TableRef[], readonly columns: readonly { table: TableRef; column: string }[]) { super("live schema drifted"); }
}
class CheckoutBlockedError extends EngineError {
  readonly code = "ENGINE_CHECKOUT_BLOCKED";
  constructor(readonly waitedMs: number, readonly blockingSessions: readonly BlockingSession[]) { super("restore blocked by locks"); }
}
class LockTimeoutError extends EngineError {           // write()/editRow() lock waits outside a restore
  readonly code = "ENGINE_LOCK_TIMEOUT";
  constructor(readonly table: TableRef, readonly waitedMs: number) { super("lock wait exceeded"); }
}
class CancelledError extends EngineError { readonly code = "ENGINE_CANCELLED"; }
class BatchWriteError extends EngineError {
  readonly code = "ENGINE_BATCH_WRITE_FAILED";
  constructor(readonly table: TableRef, readonly rowRange: readonly [number, number], readonly original: unknown) { super("batch write failed"); }
}

// ── Entry points.
function engineFor(config: PostgresConfig): DbEngine<PostgresConfig>;
function engineFor(config: MysqlConfig): DbEngine<MysqlConfig>;
function engineFor(config: MongoConfig): DbEngine<MongoConfig>;
function engineFor(config: ConnectionConfig): DbEngine;
function engineFor(config: ConnectionConfig): DbEngine { /* registry keyed on config.engine */ }

// Pure functions, siblings of the seam, not methods on it: no connection,
// no ctx, no I/O. This is also PRD §5's unit-test list, verbatim.
function computeFingerprint(introspection: IntrospectionResult): string;
function computeDependencyOrder(tables: readonly TableInfo[], requested: readonly TableRef[]): readonly TableRef[];  // FK closure of `requested`, ordered; throws DependencyCycleError
function diffSchema(baseline: IntrospectionResult, live: IntrospectionResult): SchemaDrift;
function validateImportRow(row: unknown, columns: readonly ColumnMeta[]): readonly string[];
```

| Category | Rule |
| --- | --- |
| Invariant | Every row crossing the seam is `RowText`: opaque, server-serialized JSON. Only `decodeRow` looks inside one, and only for display. |
| Invariant | `SnapshotSession` always pins the session time zone to UTC. Not a caller option. |
| Invariant | `restore`/`write`/`readTable` cancel through `ctx.signal`, checked between batches, which also aborts the in-flight driver call in the same process. `runQuery` cancels through `cancelQuery(queryId)` on a fresh connection, because the connection running the query is busy. |
| Invariant | Breaking `for await` early still runs adapter cleanup before `summary` settles. `summary` resolves `completed:false` on a clean early stop, rejects `CancelledError` if `signal` fired, rejects the causing error otherwise. |
| Invariant | The adapter re-filters generated and identity columns from any column list it receives; views are never a restore target; partition children fold into the parent in `introspect()` and are never restored as separate tables. |
| Invariant | `ConnectionConfig` carries plaintext, already decrypted by the caller. No `EngineError` message may embed it. This module never encrypts, decrypts, or stores a credential. |
| Invariant | `RunningQuery.sqlPreview` is API/UI data, not log data. `ctx.event` may never receive query text, row data, or credentials. |
| Invariant | The port does not serialize calls against one config. One job per connection record is the jobs module's guarantee, not this seam's. |
| Ordering | `readTable` yields rows sorted by primary key; PK-less tables sort by row hash (`RowChunk.lastKey.by`). |
| Ordering | `RestorePlan.tables` must already be in dependency order (`computeDependencyOrder`'s output) — the adapter does not reorder or compute the FK closure itself. |
| Error mode | Lock waits inside `restore` time out into `CheckoutBlockedError` with named, terminable blocking sessions. Lock waits inside `write`/`editRow` time out into the plainer `LockTimeoutError` — only restore pays for the session lookup. |
| Error mode | Unsupported column types are never thrown. They live in `IntrospectionResult.unsupportedColumns` and every summary's `warnings`. |
| Error mode | `restore` re-validates the live schema against `RestorePlan` and throws `SchemaDriftError` on a mismatch — a late race guard behind the checkouts module's own pre-flight drift comparison. |
| Configuration | Every `ConnectionConfig` this module receives has already passed `lib/netguard`; the port never resolves a hostname or applies a deny list itself. |
| Configuration | `ctx.event` is required on every call; `ctx.signal` is optional. |
| Performance | No bulk-copy path — Bun's driver has none. `restore` and `write` batch inserts; batch size and connection parallelism are the tuning levers (PRD 4.15). `PerformanceHints` are hints an adapter may clamp or ignore, never semantics a caller depends on. |

## 2. Usage

**Snapshot job (states module).** Open once, introspect and read every table from the same point-in-time view, close once:

```typescript
async function snapshotAdapter(config: ConnectionConfig, excludeTables: readonly TableRef[], ctx: OpContext) {
  const engine = engineFor(config);
  const session = await engine.openSnapshotSession(config, ctx);
  try {
    const introspection = await session.introspect(ctx);
    const fingerprint = computeFingerprint(introspection);
    const manifest = [];
    for (const table of introspection.tables) {
      if (excludeTables.some((t) => sameTable(t, table.table))) continue;
      const { items, summary } = session.readTable(table.table, ctx);
      const blob = await blobStore.writeGzipped(flatten(items));  // states module, not this seam
      manifest.push({ table: table.table, blobHash: blob.hash, ...(await summary) });
    }
    return { fingerprint, manifest, warnings: introspection.unsupportedColumns };
  } finally {
    await session.close();
  }
}
```

The diffs module's live-side read is the same call: it opens a session over the one table it needs and calls `readTable` again — a diff is a merge of two calls to one method, not a second read path.

**Query runner (data module).** The id is available before the rows finish, so the running-queries panel and cancel work mid-flight:

```typescript
async function runUserQuery(config: ConnectionConfig, text: string, mode: "read" | "write", actorId: string, ctx: OpContext) {
  const engine = engineFor(config);
  const stream = engine.runQuery(config, {
    dialect: "sql", text, mode, rowCap: 500, byteBudgetBytes: 10_000_000, timeBudgetMs: 30_000,
    tag: `actor:${actorId}`,
  }, ctx);

  runningQueries.register(config, await stream.queryId);
  const columns = await stream.columns;
  const rows: DisplayRow[] = [];
  for await (const chunk of stream.items) {
    for (const row of chunk.rows) rows.push(engine.decodeRow(row, columns));
  }
  const summary = await stream.summary;   // truncatedByRowCap etc. feed ctx.event.op directly
  runningQueries.unregister(config, await stream.queryId);
  return { rows, summary };
}
```

Grid paging is not a separate call: the data module builds `{ dialect: "sql", text: "...WHERE (id) > ($1) ORDER BY id LIMIT $2" }` (or an offset variant when there is no primary key) and hands it to the same `runQuery`.

## 3. What the implementation hides

The DECLARE/FETCH cursor loop that stands in for Postgres's missing cursor API, MySQL's keyset `LIMIT` loop, and MongoDB's native cursor all collapse into one `EngineStream<RowChunk, …>`. Which SQL got sent is hidden too: tagged templates (`sql\`…\``) for anything Testate generates — introspection, DECLARE/FETCH, dependency-ordered inserts — and `sql.unsafe()` only for the verbatim text a user typed into the query box, where there is nothing left to parameterize. Row-cap, byte-budget, and time-budget mechanics differ per engine and stay hidden: subquery wrapping for capped reads, MySQL's `max_execution_time` in milliseconds against MariaDB's `max_statement_time` in seconds, byte counting done client-side as chunks arrive because no engine has a byte-budget primitive. Batch sizing under MySQL's packet limit, `OVERRIDING SYSTEM VALUE`-style identity inserts, and the two-phase insert-then-update for a nullable self-referencing FK are all adapter-private. So is deferring constraints to commit whenever `capabilities.supportsDeferrableConstraints` is true — always on when available, never a caller decision, unlike trigger disable, which does carry real behavioral consequences and stays caller-visible in `RestorePlan.disableTriggers`. MongoDB's session lifecycle (`ClientSession`, `withTransaction`, `readConcern: "snapshot"`), canonical (non-relaxed) Extended JSON encode/decode, and the 16 MB per-document check live entirely inside `MongoAdapter`. So does the exact system view each adapter reads for `listRunningQueries` and blocking sessions — `pg_stat_activity`, `information_schema.processlist`/`performance_schema`, `currentOp()` — and how `cancelQuery`/`terminateSessions` open a second connection to issue `pg_cancel_backend`/`pg_terminate_backend`, `KILL QUERY`/`KILL`, or `killOp()`.

## 4. Dependency strategy and adapters

Three production adapters — `PostgresAdapter`, `MysqlAdapter` (serving MySQL and MariaDB, dialect branches inside), `MongoAdapter` — each implement `DbEngine<TheirConfig>`. The SQL adapters wrap Bun's built-in `SQL` client (`sql\`…\``, `sql.begin`, `sql.reserve`, `sql.unsafe`); `MongoAdapter` wraps the official `mongodb` driver. `engineFor` is a plain object literal keyed on `config.engine` — no DI container, because a switch is the entire framework three-soon-four cases need. The in-memory fake, `FakeEngine`, implements the same generic `DbEngine` over `Map<string, RowText[]>`. Its `Capabilities`/`RestoreStrategy` are mutable per test, so a test can exercise "no truncate privilege" without a database; it produces `RowText` with `JSON.stringify`, honors `ctx.signal`, and enforces row/byte/time caps for real, so API tests (Hono in-process, PRD §5) exercise the actual request contract with no engine underneath.

Adding SQL Server means one new `ConnectionConfig` member, one new adapter, one new `engineFor` case. Its probe reports `canDisableTriggers` via `DISABLE TRIGGER ALL`, `emptyMode: "truncate"` (or `"delete"` when FK'd), and `FOR JSON PATH` stands in for `to_jsonb` as the server-side serialization primitive — the `RowText` contract is unchanged. CockroachDB mostly reuses `PostgresAdapter`, being wire-compatible, with a different `Capabilities` (no session-wide trigger disable) and a different cancel path (`CANCEL QUERY`, not `pg_cancel_backend`) — a config flag or a thin subclass, a Sprint 0 decision, not a today decision.

Integration tests (docker compose, PRD §5) run one contract suite against every adapter through this exact interface: probe and strategy selection, introspect including partitions and unsupported types, consistent snapshot under concurrent writes, restore with an out-of-scope referencing table, drift, force restore, counter reset and repair, lock timeout, type round-trip, query limits and cancel, read-only enforcement. Every item on that list is a call through `DbEngine`, never a peek at adapter internals — that is what makes it one contract suite instead of three unrelated test files. Internal seams below the port, adapter-private and never exported: the cursor/keyset batching loop, the connection-pool-per-config cache, and the system-view queries behind `listRunningQueries`.

## 5. Trade-offs

High leverage sits in three places. `EngineStream<Item, Summary>` is one shape, learned once, driving `readTable`, `restore`, `write`, and `runQuery` — four operations, one cleanup rule. `RowText` is one invariant ("never parsed except by `decodeRow`") that alone explains why every exotic type in PRD 4.2 round-trips, instead of a per-type conversion table. Grid paging is not a method at all — it is `runQuery` fed Testate-built SQL instead of user-typed SQL, so keyset paging, offset paging, saved queries, and ad hoc SQL share one code path and one place where caps are enforced.

Leverage is thin at `editRow`. It deliberately does not reuse `write`'s `WriteOp` machinery: a single PK-addressed row from an HTTP handler wants `await` one row and return, not iterate a stream of length one and await a summary built for a five-million-row import. That asymmetry is kept on purpose — forcing the common case through machinery built for the uncommon case is not leverage, it is ceremony.

Import gets the least out of `write`. `upsert`'s `keyColumns` may not be the primary key, so the adapter builds a genuinely different statement per `WriteOp.kind` (`ON CONFLICT`, `ON DUPLICATE KEY`, a Mongo `bulkWrite` upsert), and `mode: "replace"` shares no code with `restore`'s whole-adapter, FK-closure-aware emptying — two emptying paths that look alike and are not, because replace only ever touches one table and never has to reason about tables outside the mapping's target.

Three refusals, deliberate. No lock or mutex on `DbEngine`: one-job-per-connection-record is the jobs module's contract, and putting it here would force the port to know what a connection record is. No `netguard` call inside any method: address policy is cross-cutting — storage and REST adapters need the identical check — so it runs once, before a `ConnectionConfig` ever reaches this module, not three times inside it. No caller-settable `RestoreStrategy` and no open `Record<string, boolean>` capability bag: capability flow is one-directional, engine-probed to caller-displayed, every named flag is one PRD names; the single `engineSpecific` escape hatch is UI-hint-only by contract — the day two engines need the same flag, it graduates to a named field, not a stringly-typed lookup — the type system stays the enforcement mechanism, not a convention someone has to remember.
