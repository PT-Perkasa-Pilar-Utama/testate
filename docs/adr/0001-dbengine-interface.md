# ADR 0001: The `DbEngine` interface

**Date:** 2026-08-28
**Status:** Accepted
**Deciders:** Tech Lead
**Alternatives on record:** [alternatives/](0001-dbengine-interface/alternatives/) (four independent drafts: minimal, flexible, common caller first, ports and adapters)

## Context

`DbEngine` is the port in `apps/api/src/lib/engines/` through which every vertical module reaches a target database: `adapters` (probe), `data` (grid, query, inline edit), `imports` (batched writes), `states` (snapshot), `checkouts` and deletions (restore), `diffs` (live read). Three production adapters sit behind it (Postgres and MySQL/MariaDB on Bun's `SQL`, MongoDB on the official driver) plus an in-memory fake for API tests. Its shape decides what is testable without a database, where dialect knowledge lives, and how much every caller must know. It is the hardest interface in the project to change later, so it was designed four times under different constraints and compared by depth, locality, and seam placement.

## Decision

Take the common-caller-first draft as the base and graft four things onto it.

### Outer contract

```ts
// apps/api/src/lib/engines/index.ts
export type EngineKind = "postgres" | "mysql" | "mongodb";  // MariaDB is a dialect the probe reports
export type ConnectionConfig = PostgresConfig | MysqlConfig | MongoConfig;  // decrypted; never leaves lib/engines
export type ConnectionRef = { connectionId: string; config: ConnectionConfig };

export type RowText = string & { readonly __rowText: unique symbol };   // server-serialized JSON, never parsed here
export type SortKey = { by: "primary-key"; value: JsonScalar[] } | { by: "row-hash"; value: string };
export type EncodedRow = { key: SortKey; json: RowText };
export type RowChunk = { table: TableRef; rows: EncodedRow[]; bytes: number };

export interface SnapshotRun extends AsyncIterable<RowChunk>, AsyncDisposable {
  readonly manifest: Promise<SnapshotManifest>;   // pull-driven: nothing happens until drained; dispose to abandon
}
export interface CheckoutRun extends AsyncIterable<CheckoutProgress> {
  readonly result: Promise<CheckoutResult>;       // push-driven: starts on call; result settles whether or not read
}

export interface DbEngine {
  probe(config: ConnectionConfig, event: WideEvent): Promise<ProbeResult>;          // stateless; draft connections
  introspect(conn: ConnectionRef, event: WideEvent): Promise<Introspection>;
  snapshot(conn: ConnectionRef, opts: SnapshotOptions, event: WideEvent): SnapshotRun;
  checkout(conn: ConnectionRef, plan: CheckoutPlan, event: WideEvent): CheckoutRun;
  repairCounters(conn: ConnectionRef, tables: TableRef[], event: WideEvent): Promise<CounterReport>;
  readTable(conn: ConnectionRef, table: TableRef, opts: ReadOptions, event: WideEvent): AsyncIterable<RowChunk>;
  pageRows(conn: ConnectionRef, query: PageQuery, event: WideEvent): Promise<Page>;
  runQuery(conn: ConnectionRef, query: EngineQuery, opts: QueryOptions, event: WideEvent): Promise<QueryResult>;
  listRunningQueries(conn: ConnectionRef, event: WideEvent): Promise<RunningQuery[]>;
  cancelQuery(conn: ConnectionRef, queryId: string, event: WideEvent): Promise<void>;
  editRow(conn: ConnectionRef, edit: RowEdit, event: WideEvent): Promise<EditResult>;
  writeRows(conn: ConnectionRef, spec: WriteSpec, event: WideEvent): Promise<WriteReport>;
  decodeRow(row: RowText, columns: ColumnSchema[]): DisplayRow;                       // pure, for display only
}

// Pure siblings, exported next to the port. No connection, no event, no I/O.
export function computeFingerprint(introspection: Introspection): string;
export function computeDependencyOrder(tables: TableSchema[], requested: TableRef[]): DependencyPlan;  // DB-wide FK closure; throws on an unbreakable cycle
export function diffSchema(baseline: Introspection, live: Introspection): SchemaDrift;
export function selectRestoreStrategy(capabilities: Capabilities, introspection: Introspection, plan: DependencyPlan): RestoreStrategy | StrategyRefusal;
export function validateImportRow(row: unknown, columns: ColumnSchema[]): string[];

export class EngineError<K extends EngineErrorKind = EngineErrorKind> extends Error {
  readonly kind: K; readonly details: EngineErrorDetails[K]; readonly retriable: boolean;
}
export type EngineErrorKind =
  | "unreachable" | "auth_failed" | "version_too_old" | "privilege_missing" | "schema_drift"
  | "checkout_blocked" | "lock_timeout" | "cancelled" | "batch_failed" | "document_too_large";
```

### The four grafts

| Graft | From | Why |
| --- | --- | --- |
| `RowText` and `EncodedRow` as the only row shape for snapshot, restore, and `readTable`; `decodeRow` for display | flexible | One invariant explains every type round-trip: nothing re-encodes a value the server did not serialize |
| Pure exports: fingerprint, dependency order, drift, strategy selection, import validation | flexible, ports | The deletion plan and the checkout pre-flight need drift and strategy without running a restore; unit tests need them without an engine |
| Inner ports inside each adapter: `CapabilityProbe`, `TypeCodec`, `CancelChannel`; `SnapshotReader` stays private | ports | Codec is reused by four outer methods per engine; the cancel handle must outlive the request that captured it; the probe is the seam the planner test swaps |
| Typed error details per kind; no raw driver escape hatch; no caller-composed transaction | minimal | Callers branch on `kind` with typed `details`; the seam stays a seam |

`checkout()` still calls the pure planner internally, so the hot path stays three lines. The exports exist for pre-flight and tests, not for the job.

### Rules a caller must know

| Rule | Detail |
| --- | --- |
| Two runs, two lifecycles | `SnapshotRun` produces data and is pull-driven: drain it or dispose it. `CheckoutRun` consumes data and is push-driven: it starts on call and `result` settles regardless. Never treat them alike. |
| Consistency | One `snapshot()` is one instant per connection record: Postgres repeatable-read transaction with a server-side cursor per table, MySQL/MariaDB consistent-snapshot transaction with keyset chunks (non-transactional tables read outside it and flagged), MongoDB snapshot read concern on replica sets and best effort standalone. |
| Ordering | Chunks sort by primary key, or row hash when a table has none. `checkout` orders tables by the dependency plan, not by the order given. |
| Drift | `checkout` re-introspects and fails with `schema_drift` unless `onDrift: "force"`; force restores the intersection and reports skipped tables, skipped columns, and defaulted columns. |
| Limits | `runQuery` and `pageRows` take row cap, byte budget, and time budget from the caller and clamp to the configured ceiling themselves. Read mode is a read-only transaction on the SQL engines and a read-role credential or operation filter on MongoDB; `ProbeResult.readOnlyEnforcement` says which. |
| Cancel | `cancelQuery` and a job's abort signal both reach the engine: a second connection issues `pg_cancel_backend`, `KILL QUERY`, or `killOp`. MongoDB cancel is advisory (next yield point). |
| Counters | Sequence and auto-increment resets run after the data transaction commits as a tracked step; `repairCounters` re-runs it. |
| Secrecy | `ConnectionConfig` never appears in a result, an error, or the wide event. Events carry ids, counts, bytes, durations, and codes. |
| Concurrency | The port does not serialize calls per connection record; the jobs module does. |

### Implementation rules for the adapters

- Bun's `sql.begin()` ends its transaction when the callback returns, so a snapshot cannot live inside it. `SnapshotReader` takes `sql.reserve()`, issues `BEGIN ISOLATION LEVEL REPEATABLE READ` and `SET LOCAL TIME ZONE 'UTC'` by hand, then loops `DECLARE` and `FETCH` on Postgres, or keyset `SELECT` inside `START TRANSACTION WITH CONSISTENT SNAPSHOT` on MySQL and MariaDB. The restore transaction uses the same reserved-connection pattern.
- `runQuery` reserves its own connection, reads `pg_backend_pid()` or `CONNECTION_ID()` first, and hands the handle to `CancelChannel`, a process-wide registry keyed by connection record and query id.
- `TypeCodec` builds column-list inserts from introspection, skips generated columns, overrides identity columns, and on MongoDB measures canonical Extended JSON size against the 16 MB limit before a document enters a snapshot.
- A connection pool per connection record, keyed by `connectionId`, evicted when host, port, or database changes. The pool calls `lib/netguard` on every physical connect.
- `MysqlEngine` branches on the dialect the probe reported for the timeout variable (`max_execution_time` in milliseconds on MySQL, `max_statement_time` in seconds on MariaDB) and the version floor.
- Driver errors (SQLSTATE, `ER_*`, MongoDB labels) are translated to `EngineError` inside each adapter, never behind a shared seam.

## Consequences

- The integration contract suite (docker compose, four engines) runs through the outer contract only; the fake never substitutes for it. Planner, fingerprint, drift, and validation get engine-free unit tests through the pure exports.
- `editRow` needs the primary key shape, so the data module introspects once per request and caches it; three edits are three calls.
- Adding an engine is one `ConnectionConfig` member, one adapter composed of the three inner ports, one registry entry.
- The technical specification cites this ADR for the engine port's contract and expands the per-engine strategy matrix in its ad-hoc engine-port document.
