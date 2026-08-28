# `DbEngine`: ports and adapters for Testate's database layer

## 1. Interface

One `DbEngine` instance wraps one live connection to one connection record's target database. A caller gets one from `openEngine`, uses it for the length of a request or a job, and disposes it.

```ts
export type EngineKind = "postgres" | "mysql" | "mongodb";

export function openEngine(
  config: ResolvedConnectionConfig,
  event: WideEvent,
): Promise<DbEngine>;

export interface DbEngine extends AsyncDisposable {
  readonly kind: EngineKind;

  probe(event: WideEvent): Promise<CapabilityReport>;
  introspect(event: WideEvent): Promise<Introspection>;

  snapshotTables(tables: TableRef[], event: WideEvent): AsyncIterable<TableSnapshotChunk>;
  restore(plan: RestorePlan, source: TableChunkSource, event: WideEvent, onProgress?: (p: RestoreProgress) => void): Promise<RestoreReport>;
  repairCounters(tables: TableRef[], event: WideEvent): Promise<CounterRepairReport>;

  pageRows(table: TableRef, opts: PageOptions, event: WideEvent): Promise<Page<Row>>;
  readTableSorted(table: TableRef, event: WideEvent): AsyncIterable<RowChunk>;
  editRow(table: TableRef, edit: RowEdit, event: WideEvent): Promise<EditResult>;

  runQuery(text: string, opts: QueryOptions, event: WideEvent): Promise<QueryHandle>;
  listRunningQueries(event: WideEvent): Promise<RunningQuery[]>;
  cancelQuery(id: string, event: WideEvent): Promise<void>;

  writeRows(table: TableRef, spec: WriteSpec, event: WideEvent): Promise<WriteReport>;
}
```

`openEngine` resolves the connection record's decrypted config, runs the `lib/netguard` address check, connects, and returns. `TableRef` names a table, or on MongoDB a collection.

Four concerns get pulled into their own inner port. Each for a different reason, not one rule applied four times.

**`CapabilityProbe`**: version, privilege, and capability-flag checks. Adapters: `PostgresCapabilityProbe`, `MySqlCapabilityProbe` (serves MariaDB), `MongoCapabilityProbe`, `FakeCapabilityProbe`. It runs against a draft connection record still sitting in a form, before the rest of `DbEngine` can be trusted to exist. It is also the seam the restore planner is unit-tested through: swap in `FakeCapabilityProbe`, keep the real planner.

**`SnapshotReader`**: the point-in-time, per-table chunked read behind a snapshot. Adapters: `PostgresCursorReader`, `MySqlKeysetReader` (serves MariaDB), `MongoSnapshotReader`. It holds a resource whose lifecycle spans many chunks: declared cursors inside one transaction on Postgres, a held consistent-snapshot transaction on MySQL, a causally consistent session on MongoDB. Lifecycle, not reuse, earns it the name.

**`TypeCodec`**: row-to-JSON and JSON-to-insert, done server-side for fidelity. Adapters: `PostgresJsonbCodec`, `MySqlJsonObjectCodec` (serves MariaDB), `MongoExtendedJsonCodec`. Four outer methods call it inside each adapter: `snapshotTables` encodes, `restore` and `writeRows` decode, `pageRows` and `runQuery` encode again for display. Without a name, that is four row-marshalling implementations per engine instead of one.

**`CancelChannel`**: capture a running query's engine-side handle, list it, kill it later. Adapters: `PostgresCancelChannel` (`pg_cancel_backend` / `pg_terminate_backend`), `MySqlCancelChannel` (`KILL QUERY`), `MongoCancelChannel` (`killOp`). One request captures the handle; a different, later request presents it to cancel, so it needs a home that outlives both.

```ts
export interface CapabilityProbe { check(event: WideEvent): Promise<CapabilityReport> }
export interface SnapshotReader { openSnapshot(tables: TableRef[], event: WideEvent): AsyncIterable<TableSnapshotChunk> }
export interface TypeCodec {
  encodeRow(table: TableIntrospection, row: unknown): string | { skipped: EngineWarning };
  buildInsert(table: TableIntrospection, jsonLine: string): PreparedStatement;
}
export interface CancelChannel {
  capture(id: string, handle: unknown): void;
  list(event: WideEvent): Promise<RunningQuery[]>;
  cancel(id: string, event: WideEvent): Promise<void>;
}
```

`SnapshotReader`, `TypeCodec`, and `CancelChannel` have no separate fake class. `FakeEngine` answers their calls directly; nothing outside a production adapter ever needs to swap just the reader or just the codec, so naming a fake for any of them would be a seam with nothing behind it.

| Aspect | What a caller must know |
| --- | --- |
| Ordering | `snapshotTables` chunks sort by primary key, or row hash when a table has none; `restore` processes tables in the plan's dependency order, not the order passed in; self-referencing tables insert parents first, in two passes when the referencing column is nullable |
| Consistency | one `snapshotTables` call is one instant across every table requested, except MongoDB standalone, where each chunk carries `consistencyLevel: "best_effort"` instead of `"snapshot"` |
| Read-only | `runQuery({ mode: "read" })` opens a read-only transaction on Postgres and MySQL; on MongoDB it uses the read-only credential when set, an operation filter otherwise. `CapabilityReport.readOnlyEnforcement` names which, for the dashboard |
| Required config | the caller supplies row cap, byte budget, and timeout on every `runQuery` call; `DbEngine` has no built-in defaults. UTC session pin and the netguard check are automatic, not caller-set |
| Performance | streaming throughout: `snapshotTables` and `readTableSorted` never hold a whole table in memory, MySQL batches insert under the server packet limit automatically, and a row cap wraps the statement as a sub-query so the engine stops early rather than Testate discarding already-fetched rows |
| Concurrency | `DbEngine` does not enforce one job per connection record; that rule lives in the jobs module |
| Secrecy | the decrypted connection config enters the driver and never leaves it; `EngineError` and the wide event carry ids, counts, and codes, never credentials, row data, or query text |

| Error kind | HTTP code | Notes |
| --- | --- | --- |
| `unreachable` | `ADAPTER_UNREACHABLE` 502 | host down, refused, or timed out |
| `auth_failed` | `ADAPTER_UNREACHABLE` 502 | wrong credential, kept distinct so a log can tell the two apart even though the HTTP code can't |
| `version_too_old` | `ENGINE_UNSUPPORTED` 422 | carries `found` and `minimum` |
| `privilege_missing` | `ENGINE_UNSUPPORTED` 422 while planning, job `partial` mid-restore | names the privilege and a grant hint; mostly a planner refusal, reaching `restore` only if a grant was revoked after probe |
| `drift` | `SCHEMA_DRIFT` 409 | carries the differing tables and columns |
| `lock_timeout` | `CHECKOUT_BLOCKED` 409 | carries blocking sessions when the engine exposes them; `restore` is the only caller today |
| `cancelled` | `CONFLICT` 409 for a synchronous query, job status `cancelled` for a job | |
| `batch_failed` | reported in the job's report, not an HTTP code | names the table and the ordinal row range |

Unsupported column types never appear here. They ride as a `warning` on `introspect` and `snapshotTables` results. Every method rejects with `EngineError`, a closed union keyed by the `kind` column above; each adapter translates its own driver's errors (SQLSTATE, `ER_*` codes, Mongo error labels) into it, so translation lives per adapter, not behind a seam.

| Candidate seam | Verdict | Why |
| --- | --- | --- |
| Transport and connection | Private | One implementation per outer adapter (Bun's `SQL` for two engines, `mongodb` for the third), and the fake has none. `lib/netguard`'s check is an existing dependency `openEngine` calls, not a port of its own |
| Session and transaction | Private | No caller wants a generic begin/commit through `DbEngine`, and MongoDB has no SQL transaction, so a shared interface would be fiction for one of three engines. Folded into `SnapshotReader`'s own transaction and `restore`'s write transaction |
| Dialect of SQL | Private | MariaDB is a value (`dialect: "mariadb"` on `CapabilityReport`), not a second adapter. `MySqlEngine` branches on it for the timeout variable name and the version floor, and the change stays local to that one file |
| Restore strategy selection | Private, pure function | `selectRestoreStrategy` has one implementation, branched by engine tag inside, reusing the same dependency-closure code for Postgres and MySQL. Nothing swaps it; a test calls it directly |
| Introspection | Private, plain method | Called by four vertical modules, but no other `DbEngine` method delegates to it, and it needs nothing `probe` needs: a live, already-trusted connection, unlike a draft one |
| Query row/byte/time budgets | Private | One mechanism per production engine, no caller beyond `runQuery` itself, nothing to hold onto after the call returns |

## 2. Usage

**Snapshot job, states module.**

```ts
export async function runSnapshotJob(job: SnapshotJob, event: WideEvent): Promise<void> {
  const config = await resolveConnectionConfig(job.connectionRecordId);
  await using engine = await openEngine(config, event);

  const introspection = await engine.introspect(event);
  const fingerprint = computeFingerprint(introspection);
  const tables = introspection.tables.filter(t => !job.excludedTables.has(t.name));

  for await (const chunk of engine.snapshotTables(tables.map(toTableRef), event)) {
    await blobStore.appendChunk(job.stateId, chunk.table, chunk.lines);
    if (chunk.warning) event.push("op.warnings", chunk.warning);
    if (chunk.isFinalForTable) await blobStore.sealTable(job.stateId, chunk.table);
  }

  event.merge("engine", { strategy: "snapshot", warnings: introspection.warnings });
  await metadataDb.recordManifest(job.stateId, { fingerprint, tables, blobs: await blobStore.hashesFor(job.stateId) });
}
```

`computeFingerprint`, `blobStore`, and `metadataDb` sit outside `DbEngine` entirely: fingerprinting is a pure function over `Introspection`, the blob store is the snapshot-store port, the manifest write is metadata persistence. `DbEngine`'s job ends at handing back chunks.

**Query runner, data module.**

```ts
export async function runUserQuery(req: RunQueryRequest, event: WideEvent) {
  const engine = await engineFor(req.connectionRecordId, event);
  event.add("op", { name: "run_query", mode: req.mode, query_hash: hashQuery(req.sql) });

  const handle = await engine.runQuery(req.sql, {
    mode: req.mode,
    rowCap: req.rowCap ?? settings.defaultRowLimit,
    byteBudget: settings.queryByteBudget,
    timeoutMs: settings.queryTimeoutMs,
  }, event);

  return handle.rows;
}

export async function cancelRunningQuery(connectionRecordId: string, queryId: string, event: WideEvent) {
  const engine = await engineFor(connectionRecordId, event);
  await engine.cancelQuery(queryId, event);
}
```

The row cap, byte budget, and timeout are the caller's numbers, resolved from settings before the call; `DbEngine` enforces them but never chooses them. `cancelRunningQuery` runs on a request that never touched the connection `queryId` started on. `CancelChannel` is what makes that safe.

**Restore planner, unit-tested through `CapabilityProbe`.**

```ts
test("cycle without trigger-disable privilege refuses before touching data", async () => {
  const probe = new FakeCapabilityProbe({
    engine: "postgres",
    engineVersion: "16.2",
    meetsMinimumVersion: true,
    flags: { canDisableTriggers: false, supportsDeferrableConstraints: false /* … */ },
    readOnlyEnforcement: "transaction",
    tableCount: 2,
    sizeEstimateBytes: 0,
  });
  const capabilities = await probe.check(testEvent());
  const introspection = fixtureIntrospectionWithSelfCycle({ nullable: false });

  const result = selectRestoreStrategy(capabilities, introspection, { tables: ["nodes"] });

  expect(result).toEqual({
    ok: false,
    reason: "privilege_missing",
    privilege: "trigger disable (superuser, or a Postgres 15 grant on the replication-role parameter)",
    grantHint: expect.any(String),
  });
});
```

The test never opens a socket. It builds a `CapabilityReport` value through the same port a real `PostgresEngine` would use, pairs it with a fixture `Introspection`, and calls the exact pure planner `restore` calls in production.

## 3. What the implementation hides

`SnapshotReader.openSnapshot` never uses `sql.begin`: that callback's transaction ends when the callback returns, and a chunk stream must outlive it. It calls `sql.reserve()` for one exclusive connection, issues `BEGIN ISOLATION LEVEL REPEATABLE READ` and `SET LOCAL TIME ZONE 'UTC'` by hand, then per table runs `DECLARE cur CURSOR FOR SELECT to_jsonb(t) FROM …` and loops `FETCH 1000 FROM cur` as plain `sql.unsafe` calls: Bun's driver has no cursor object and no `COPY`, only tagged queries returning one materialized array each. One `FETCH` result is one chunk. MySQL has no cursor at all: the reader opens `START TRANSACTION WITH CONSISTENT SNAPSHOT` on a reserved connection and pages by keyset inside it; non-transactional tables get read in a second, unsynced pass and flagged. MongoDB opens a causally consistent session with `readConcern: "snapshot"` on a replica set (`CapabilityReport.flags.supportsSnapshotRead`), and falls back to a plain, `best_effort`-flagged read otherwise.

`runQuery` also reserves its own connection, and before running the caller's statement it runs `SELECT pg_backend_pid()` or `SELECT CONNECTION_ID()` on that same connection and hands the result to `CancelChannel.capture`. Bun's own `.cancel()` on a query object only works from inside the process still holding that object; it can't help a second HTTP request cancel a query the first one started, so `DbEngine` keeps its own handle instead.

`TypeCodec.buildInsert` skips generated columns and overrides identity columns using flags `introspect` already collected. On MongoDB it checks each document's encoded size against 16 MB before it enters a snapshot, marking an oversized document skipped rather than failing the whole table. On MySQL the codec builds a `JSON_OBJECT` server-side rather than trust the driver's own row decode: that decode turns `DATETIME` into a `Date` with no timezone on the wire and `BIGINT` into a number or string depending on size, fine for an ordinary read, too lossy for a snapshot. MySQL also has no `RETURNING`, so `writeRows` and `editRow` fall back to `result.lastInsertRowid` or a follow-up `SELECT`.

## 4. Dependency strategy and adapters

Three production adapters do the real work: `PostgresEngine`, `MySqlEngine` (serves MySQL and MariaDB with per-dialect branches), and `MongoEngine`. Each composes its own `CapabilityProbe`, `SnapshotReader`, `TypeCodec`, and `CancelChannel` privately, and nothing outside an adapter's own file holds those pieces separately. That's locality: a change to Mongo's kill mechanism never touches Postgres's file. `FakeEngine` implements `DbEngine` directly against `Map`-backed tables, with no inner-port composition of its own. There's no second thing standing behind a fake reader or a fake codec, so none exists.

The integration contract suite (docker compose, real engines, per the PRD's testing decisions) runs the same tests against all three production adapters through the outer port: probe and strategy selection against `probe` and `selectRestoreStrategy`; introspect (partitions, unsupported types); consistent snapshot under concurrent writes against `snapshotTables`; restore, drift, force restore, and counter reset with repair against `restore` and `repairCounters`; lock timeout against `restore`'s `CHECKOUT_BLOCKED` path; type round-trip against `TypeCodec`, snapshot then restore; query limits, cancel, and read-only enforcement against `runQuery`, `cancelQuery`, and its mode. The suite never touches `FakeEngine`. `FakeEngine` and `FakeCapabilityProbe` exist for two jobs only: API tests driving job and route logic over HTTP without a database, and the planner unit test above.

## 5. Trade-offs

`TypeCodec` has the most leverage in the module: two methods learned, correct round-tripping for arrays, enums, `bigint`, and `decimal128` across three engines that agree on almost nothing else. `CapabilityProbe` runs it close: it turns "can I do X" into one field lookup everywhere that question comes up, in the adapters module, the planner, the dashboard.

`CancelChannel` is thinnest on MongoDB. `killOp` interrupts at the next yield point in a pipeline, not instantly, so the contract calls that adapter's cancel "advisory" rather than promising a uniform guarantee, and a caller needing a hard stop within a fixed budget has to know that going in.

`SnapshotReader` is the seam I would cut first if pushed. Its case rests on lifecycle, not reuse: today exactly one caller, the snapshot job, touches it. Fold it into a private method on each production adapter and the outer interface loses nothing any test or caller exercises today. I kept it because the three mechanisms behind it (a declared cursor, a keyset scan inside a held transaction, a session-scoped read concern) differ in kind, not just in SQL text, and naming the boundary keeps that difference out of `restore` and `runQuery`'s own files. If a second caller ever needs a consistent multi-table read, the bet pays off; if not, it's one interface's ceremony for one implementation.
