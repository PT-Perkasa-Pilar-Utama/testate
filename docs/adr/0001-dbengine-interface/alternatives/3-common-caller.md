# DbEngine

DbEngine answers one question, asked many ways: *talk to a live database and hand back structured facts, or move rows.* Everything computable from facts already in hand — fingerprint hashing, drift diffing, foreign-key ordering, diff merges — is a pure function that lives beside this module, not inside it. The port holds only what needs a socket. Every call targets one connection record; a checkout that spans a state's several connection records loops above this port, one call per connection, in parallel.

## 1. Interface

```ts
// Supporting types — apps/api/src/lib/engines/types.ts
import type { WideEvent } from "../logger";

type EngineKind = "postgres" | "mysql" | "mariadb" | "mongodb";
interface ConnectionConfig { readonly kind: EngineKind }              // decrypted, opaque outside a driver
interface ConnectionRef { readonly connectionId: string; readonly config: ConnectionConfig }

interface TableRef { readonly schema: string | null; readonly name: string }
interface EngineWarning { code: string; table?: TableRef; column?: string; message: string }

interface ColumnSchema { name: string; dataType: string; nullable: boolean; hasDefault: boolean; generated: boolean; identity: boolean }
interface TableSchema {
  ref: TableRef;
  kind: "table" | "view" | "partition_parent" | "inheritance_child";
  columns: ColumnSchema[];
  primaryKey: string[] | null;
  foreignKeys: { columns: string[]; refTable: TableRef; refColumns: string[] }[];
  uniqueConstraints: string[][];
  checkConstraints: string[];
  collectionOptions?: Record<string, unknown>;   // mongodb only; counted in the fingerprint
  unsupported: { column: string; reason: string }[];
}
interface Introspection { tables: TableSchema[] }

interface ProbeResult {
  engineVersion: string;
  minimumVersionOk: boolean;
  capabilities: { disableTriggers: boolean; setReplicationRole: boolean; truncate: boolean; terminateSessions: boolean; transactionalRestore: boolean; deferrableConstraints: boolean };
  tableCount: number;
  sizeEstimateBytes: number;
  restoreStrategy: { empty: "truncate" | "delete"; triggerDisable: boolean; deferrable: boolean };
  readOnlyEnforcement: "transaction" | "credential" | "filter";
}

interface EncodedRow { key: string; json: string }         // key: PK tuple or row hash; json: server-serialized row

interface SnapshotOptions { excludeTables?: TableRef[]; chunkRows?: number; signal?: AbortSignal }
interface SnapshotChunk { table: TableRef; rows: EncodedRow[] }
interface SnapshotManifest {
  tables: { schema: TableSchema; rows: number; bytes: number }[];
  fingerprint: string;
  warnings: EngineWarning[];
}
interface SnapshotRun extends AsyncIterable<SnapshotChunk>, AsyncDisposable {
  readonly manifest: Promise<SnapshotManifest>;             // resolves only once the run is fully drained
}

interface CheckoutPlan {
  tables: SnapshotManifest["tables"];                       // the state's captured slice for this connection
  rows: (table: TableRef) => AsyncIterable<EncodedRow>;      // caller wires this to decompressed blob reads
  onDrift: "fail" | "force";
  lockTimeoutMs?: number;
  signal?: AbortSignal;
}
interface CheckoutResult {
  status: "restored" | "rolled_back" | "unknown";
  tables: { ref: TableRef; rows: number }[];
  skipped: { tables: TableRef[]; columns: { table: TableRef; column: string }[] };
  defaultedColumns: { table: TableRef; column: string }[];
  countersReset: { name: string; ok: boolean }[];
  lockWaitMs: number;
  warnings: EngineWarning[];
}
interface CheckoutRun extends AsyncIterable<{ table: TableRef; rowsWritten: number }> {
  readonly result: Promise<CheckoutResult>;                 // settles whether or not progress is ever read
}

interface PageQuery { table: TableRef; sort?: { column: string; dir: "asc" | "desc" }[]; filter?: { column: string; op: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "like" | "is_null"; value?: unknown }[]; cursor?: string; limit: number }
interface Page { rows: Record<string, unknown>[]; nextCursor: string | null; pageKind: "keyset" | "offset" }

type EngineQuery = { sql: string } | { mongo: { kind: "find" | "aggregate" | "updateMany" | "deleteMany" | "insertMany"; collection: string; body: object } };
interface RunQueryOptions { mode: "read" | "write"; rowCap: number; byteBudget: number; timeBudgetMs: number; signal?: AbortSignal }
interface QueryResult { rows: Record<string, unknown>[]; truncated: boolean; columns: { name: string; dataType: string }[]; queryId: string; queryHash: string; durationMs: number }
interface RunningQuery { queryId: string; queryHash: string; elapsedMs: number; state: string }

type RowEdit =
  | { kind: "insert"; table: TableRef; values: Record<string, unknown> }
  | { kind: "update"; table: TableRef; pk: Record<string, unknown>; values: Record<string, unknown> }
  | { kind: "delete"; table: TableRef; pk: Record<string, unknown> };

interface WriteBatchOptions { table: TableRef; mode: "append" | "upsert" | "replace"; keyColumns?: string[]; rows: AsyncIterable<Record<string, unknown>>; signal?: AbortSignal }
interface WriteBatchResult { inserted: number; updated: number; skipped: number; failed: { rowIndex: number; reason: string }[]; warnings: EngineWarning[] }
```

```ts
// The port — apps/api/src/lib/engines/index.ts
interface Engine {
  probe(config: ConnectionConfig, event: WideEvent): Promise<ProbeResult>;
  introspect(conn: ConnectionRef, event: WideEvent): Promise<Introspection>;
  snapshot(conn: ConnectionRef, opts: SnapshotOptions, event: WideEvent): SnapshotRun;
  checkout(conn: ConnectionRef, plan: CheckoutPlan, event: WideEvent): CheckoutRun;
  repairCounters(conn: ConnectionRef, tables: TableRef[], event: WideEvent): Promise<{ repaired: { name: string; ok: boolean }[] }>;
  pageRows(conn: ConnectionRef, query: PageQuery, event: WideEvent): Promise<Page>;
  runQuery(conn: ConnectionRef, query: EngineQuery, opts: RunQueryOptions, event: WideEvent): Promise<QueryResult>;
  listRunningQueries(conn: ConnectionRef, event: WideEvent): Promise<RunningQuery[]>;
  cancelQuery(conn: ConnectionRef, queryId: string, event: WideEvent): Promise<void>;
  editRow(conn: ConnectionRef, edit: RowEdit, event: WideEvent): Promise<{ row: Record<string, unknown> | null }>;
  writeRows(conn: ConnectionRef, opts: WriteBatchOptions, event: WideEvent): Promise<WriteBatchResult>;
  readTable(conn: ConnectionRef, table: TableRef, opts: { signal?: AbortSignal }, event: WideEvent): AsyncIterable<EncodedRow>;
}

const postgresAdapter: Engine = /* ... */;
const mysqlAdapter: Engine = /* ... branches internally for MariaDB ... */;
const mongoAdapter: Engine = /* ... */;
const fakeAdapter: Engine = /* ... in-memory, API tests only ... */;

export const DbEngine: Engine =
  resolveByKind({ postgres: postgresAdapter, mysql: mysqlAdapter, mariadb: mysqlAdapter, mongodb: mongoAdapter });
```

| | |
|---|---|
| **Invariant** | Every method takes `event: WideEvent` last and may only call `event.merge("engine", …)` / `event.error(…)` — never the `project`, `adapter`, or `op` sections. Nothing logs credentials, row data, or query text; a query logs as `queryHash` plus a byte count. |
| | `ConnectionConfig` never appears in a return value or an error. A thrown error carries codes and names, never the config that produced it. |
| | netguard's address check runs on every connect this module makes, including inside `probe`, before any byte leaves the process. |
| | Read paths (`pageRows`, `readTable`, `snapshot`, `runQuery` in `"read"` mode) are read-only at the session level on Postgres/MySQL/MariaDB; on MongoDB they use the connection's read-only credential when set, else an operation filter. `ProbeResult.readOnlyEnforcement` says which is active. |
| | `runQuery` clamps `rowCap`/`byteBudget`/`timeBudgetMs` to the configured ceiling itself, and `pageRows` clamps `limit` the same way; neither trusts that the caller already did. |
| | DbEngine does not enforce one job per connection record — two concurrent `checkout()` calls on the same connection will race. That guarantee belongs to the jobs module, deliberately, not here. |
| **Ordering** | `SnapshotRun` is pull-driven: nothing happens until you iterate, and the transaction stays open until the run is drained or disposed (`await using`). Abandoning the loop cancels that snapshot; `manifest` never resolves. |
| | `CheckoutRun` is push-driven: `checkout()` starts writing immediately. `result` settles whether or not progress is ever read — progress is a tap, not a trigger. |
| | `checkout()` trusts that `plan.tables` came from the manifest the caller already chose; it does not fetch a state itself. It re-introspects the live side and fails on drift unless `onDrift: "force"`. |
| | `writeRows({ mode: "upsert" })` without `keyColumns` is rejected before any row is sent. |
| **Errors** | `ADAPTER_UNREACHABLE`, `AUTHENTICATION_FAILED`, `VERSION_TOO_OLD`, `PRIVILEGE_MISSING` (names the grant), `SCHEMA_DRIFT` (names tables/columns), `CHECKOUT_BLOCKED` (the lock-timeout error; names blocking sessions when the engine exposes them), `CANCELLED`, `DOCUMENT_TOO_LARGE` (Mongo, over 16MB encoded, aborts that connection's snapshot), `BATCH_FAILURE` (names table and row range), `ENGINE_UNSUPPORTED`. Unsupported column types are warnings; everything else on this list is fatal to the call. At the REST boundary these fold one-for-one into `SCHEMA_DRIFT` / `CHECKOUT_BLOCKED` / `ADAPTER_UNREACHABLE` / `ENGINE_UNSUPPORTED`; `AUTHENTICATION_FAILED` and `VERSION_TOO_OLD` fold into the last two. |
| **Config** | `lockTimeoutMs` for checkout (default 60s, a per-connection setting). `chunkRows` for snapshot (default from settings). `rowCap`/`byteBudget`/`timeBudgetMs` are required on every `runQuery` call — the port has no built-in default, so a caller that forgets fails loudly instead of running unbounded. |
| **Performance** | Sized for five gigabytes and five hundred tables per connection; larger works, slower, and the port does not enforce the ceiling. Postgres restore is batched `INSERT`s — Bun's driver has no `COPY` — so batch size and connection parallelism are the only levers. Keyset paging is flat-cost per page; offset paging, used only for PK-less tables, gets slower with depth. That is by design, not a bug to fix later. |

## 2. Usage

**Snapshot job:**
```ts
await using run = DbEngine.snapshot(conn, { excludeTables, signal: job.signal }, event);
for await (const chunk of run) { await blobs.append(chunk.table, chunk.rows); job.progress(chunk.rows.length); }
const manifest = await run.manifest;
```

**Checkout job:**
```ts
const run = DbEngine.checkout(conn, { tables, rows: blobs.reader(state), onDrift: force ? "force" : "fail", signal: job.signal }, event);
for await (const p of run) job.progress(p);
const result = await run.result;
```

**Grid page:**
```ts
const query: PageQuery = { table, sort, filter, cursor, limit };
const page = await DbEngine.pageRows(conn, query, event);
return c.json({ data: page.rows, page: { next_cursor: page.nextCursor, limit } });
```

**Inline edit — the cost of a less common path:**
```ts
const { tables } = await DbEngine.introspect(conn, event);                 // must learn the PK shape first
if (!tables.find(t => refEq(t.ref, table))?.primaryKey) throw new NoPrimaryKeyError(table);
const { row } = await DbEngine.editRow(conn, { kind: "update", table, pk, values }, event);
```
`pageRows` needed nothing before it ran. `editRow` needs a fresh `introspect()` to confirm a primary key exists, writes exactly one row, and offers no batching — three edits are three calls and three round trips. That is the price the design charges a caller who is not the grid.

## 3. What the implementation hides

- The capability-to-strategy decision per engine: which trigger-disable grant Postgres will accept (superuser, or the Postgres 15 replication-role grant), the MySQL `DROP`-privilege gate between `TRUNCATE` and `DELETE`, Mongo's time-series exception.
- Connection pooling keyed by `connectionId`, invisible to callers: one pooled `Bun.SQL` or `MongoClient` per connection record, reused across calls, evicted when host, port, or database changes.
- The consistent-read plumbing Bun's driver does not provide out of the box: a reserved connection running raw `DECLARE`/`FETCH` for Postgres's server-side cursor, a manual keyset loop inside a consistent-snapshot transaction for MySQL/MariaDB (a table on a non-transactional storage engine falls outside that transaction and comes back with a warning instead), a snapshot-read-concern session for Mongo that degrades to best effort on a standalone server.
- Engine-level self-cancel: on abort, a second reserved connection cancels the first connection's own in-flight statement, so a stuck `FETCH` or lock wait actually stops instead of running out its own clock.
- The type-fidelity path: every read pins the session time zone to UTC, then goes through server-side JSON so Bun's own decoder — which cannot read Postgres geometry, point, or multi-dimensional arrays — never touches those bytes. Restore reverses this with an introspection-derived column list and server-side casts, skipping generated columns and overriding identity columns.
- Fingerprint hashing, schema-drift diffing, foreign-key ordering with cycle detection, and diff merge: pure functions the drivers call internally, never re-implemented per engine, never exposed as separate methods on the port.
- Stash is not a concept this module knows. It is a snapshot the states module takes and labels; DbEngine sees only `snapshot()`.

## 4. Dependency strategy and adapters

`Engine` is the seam. `postgresAdapter`, `mysqlAdapter` (branching for MariaDB on a dialect flag read from `probe`), and `mongoAdapter` are the three production adapters; `fakeAdapter` is an in-memory implementation of the same interface used only by API tests. `DbEngine` is a thin facade: it resolves `conn.config.kind` to one of the four and forwards the call unchanged. The facade and the seam are the same shape, so there is nothing extra to learn between "the interface" and "what I actually call."

The SQL adapters sit on `Bun.SQL`: tagged templates for typed reads and writes, `sql.unsafe` for `DECLARE`/`FETCH`/session `SET` where the shape is dynamic, `sql.begin` for the checkout transaction and the snapshot's repeatable-read wrapper, `sql.reserve` for anything that must survive across statements on one connection — a cursor, a self-cancel — released the same way Bun's own docs release one, with `using`. The Mongo adapter uses the official `mongodb` driver directly: sessions with snapshot read concern, `bulkWrite`, an admin command for the running-operations list, and canonical Extended JSON from `bson` for encoding.

Two seams sit inside the adapters, below the port, and never cross it. The pure library — fingerprint, drift diff, dependency order, diff merge — is one of them: every adapter calls into it, nothing exports it through `Engine`. The other is a single-table sorted reader shared by `snapshot()` and `readTable()` inside each SQL adapter: `snapshot()` opens one per table inside its one consistent transaction, `readTable()` exposes one bare, and both walk the same cursor/keyset code underneath. The MariaDB dialect branch inside `mysqlAdapter` is the third — same pool, same driver, a handful of statements swapped by a flag read off `probe`.

Integration tests run the docker-compose contract suite — probe and strategy selection, introspect with partitions and unsupported types, consistent snapshot under concurrent writes, restore against an out-of-scope referencing table, drift, force, counter reset and repair, lock timeout, type round-trip, cancel, read-only enforcement — against real Postgres, MySQL, MariaDB, and Mongo, calling `Engine` methods directly. That suite is the only place the three production adapters run for real. The pure functions behind them get their own fast unit tests with no engine at all; `fakeAdapter` exists only so the rest of the API can be tested without a live database, and it never substitutes for the contract suite.

## 5. Trade-offs

Depth is uneven on purpose. `introspect()` and `checkout()` are deep — one call serves four callers, or one call runs the whole restore recipe. `probe`, `cancelQuery`, `repairCounters` are shallow, and that is fine; each of them does one thing for one caller and gains nothing from being bigger. Locality is the other lever: fingerprinting, drift, dependency order, and diff merge all live in one pure library outside this module, so a rule change — say, what counts toward the fingerprint — touches one file, not three drivers and a port.

`introspect()` has the most leverage in the design: one shape, learned once, reused by the grid, by checkout's drift check, and by import's dry-run validation.

The two async-iterable-with-a-result shapes look identical and are not. Snapshot's is a lazy read you must drain; checkout's is an eager write that finishes on its own whether you watch it or not. Treating them as interchangeable is the most likely way a caller gets this port wrong.

Every write re-checks privileges at call time instead of trusting a cached probe from setup — a revoked `TRUNCATE` grant degrades the strategy instead of failing mid-restore, at the cost of one extra round trip on every checkout.

MongoDB pays for the SQL engines' convenience in one real way: checkout's promise to never leave a half state is a database transaction on Postgres and MySQL, and there is no equivalent on Mongo. `deleteMany` then `insertMany` is ordered and best effort, not atomic. The port reports whatever actually finished; it does not pretend otherwise.

`editRow` pays for `pageRows`' statelessness: no cached handle, no batching, one row per call. That is deliberate — inline edit is rare, and a batching API for it would be complexity nobody asked for.

Refused, on purpose: a raw-connection escape hatch, because the moment one caller reaches past the port, netguard, redaction, and read-only enforcement all become optional; a transaction spanning two connection records; any DDL beyond what restore itself issues, since schema migration is explicitly not this product's job; a generic batch-of-mixed-operations method, when `writeRows`, `checkout`, and `editRow` already cover the three shapes anyone asked for.
