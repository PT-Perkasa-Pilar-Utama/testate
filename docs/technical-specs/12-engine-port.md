# 12. Engine Port

The engine port, `DbEngine` in `apps/api/src/lib/engines/`, is the only way Testate touches a target database. This document expands ADR 0001 (`../adr/0001-dbengine-interface.md`) into the per-engine contract: floors, capabilities, strategy selection, consistency, type fidelity, limits, cancel, pooling, and the tier each engine belongs to. Cite this document; do not restate its tables elsewhere.

## 12.1 Decision matrix

| Concern | Decision | Rationale |
| --- | --- | --- |
| Port shape | ADR 0001 hybrid: common-caller base, `RowText` rows, pure exports, inner ports `CapabilityProbe`, `TypeCodec`, `CancelChannel` | Hot callers stay three lines; planner and drift are unit-testable without an engine |
| Engine floors | Postgres 13, MySQL 8.0, MariaDB 10.6, MongoDB 6.0; MongoDB time-series arbitrary deletes need 7.0 (probe-gated) | Below the floor a documented strategy is missing; the probe refuses with `ENGINE_UNSUPPORTED` |
| Tiers | Tabular (Postgres, MySQL, MariaDB): view, state, diff, extract, edit, import. Document (MongoDB): view, state, diff, extract. Files (S3, SFTP, FTP): view, download | The port exposes `capabilities.tier`; modules refuse operations outside the tier with `ENGINE_UNSUPPORTED` |
| Consistency | One instant per adapter per snapshot | Repeatable read plus cursor on Postgres; consistent snapshot plus keyset on MySQL and MariaDB; snapshot read concern on MongoDB replica sets, best effort standalone |
| Type fidelity | Server-side JSON text out, column-list insert with casts in; canonical Extended JSON on MongoDB | The driver's decoder never touches snapshot bytes |
| Strategy selection | `selectRestoreStrategy(capabilities, introspection, plan)` pure; re-run at job start | A revoked privilege degrades the strategy instead of failing mid-restore |
| Streaming | Postgres `DECLARE` and `FETCH` on a reserved connection; MySQL keyset loops; MongoDB native cursor; chunk of 5 000 rows or 8 MiB, whichever first | Bun's driver has no cursor API and no `COPY` |
| Cancel | Second connection issues `pg_cancel_backend`, `KILL QUERY`, or `killOp`; registry keyed by adapter and query id | The connection running the statement is busy |
| Pooling | One pool per adapter id, 4 connections, 10 minute idle close, evicted on target or credential change | Bounded file descriptors; snapshot and restore reserve one each |
| Read-only | Read-only transaction on the SQL engines; read-role credential or operation filter on MongoDB, reported by the probe | Enforcement at the engine where the engine has it |
| Errors | `EngineError` with a closed `kind` union and typed details, translated per adapter | Callers branch on `kind`; drivers' errors never leak |

## 12.2 Capability probe

`probe(config, event)` returns:

```ts
type ProbeResult = {
  engine: "postgres" | "mysql" | "mongodb";
  dialect: "postgres" | "mysql" | "mariadb" | "mongodb";
  version: string;                       // "16.3", "8.4.2", "10.11.8", "7.0.12"
  meetsFloor: boolean; floor: string;
  tier: "tabular" | "document";
  capabilities: Capabilities;
  strategy: RestoreStrategy;             // what the privileges allow today
  readOnlyEnforcement: "transaction" | "credential" | "filter";
  tableCount: number; sizeEstimateBytes: number;
  warnings: EngineWarning[];             // e.g. standalone MongoDB, non-transactional tables present
};
type Capabilities = {
  canTruncate: boolean;                  // PG: TRUNCATE privilege on every restored table; MySQL: DROP privilege
  canDisableTriggers: boolean;           // PG: superuser, or PG 15 grant on session_replication_role
  canTerminateSessions: boolean;         // PG: pg_signal_backend or superuser; MySQL: CONNECTION_ADMIN or SUPER; Mongo: killop
  supportsDeferrableConstraints: boolean;// PG: any deferrable FK present
  transactionalRestore: boolean;         // PG: true; MySQL: true in atomic mode; Mongo: false
  snapshotRead: "repeatable-read" | "consistent-snapshot" | "snapshot-read-concern" | "best-effort";
  timeSeriesDeletes: boolean;            // Mongo >= 7.0
};
```

Probe queries: Postgres `version()`, `has_table_privilege`, `pg_has_role(current_user, 'pg_signal_backend', 'member')`, `rolsuper`, `pg_settings` for `session_replication_role` grant, `pg_class.reltuples` sums; MySQL `VERSION()`, `SHOW GRANTS`, `information_schema.TABLES` sums; MongoDB `buildInfo`, `connectionStatus` roles, `hello` (replica set), `listCollections` count, `dbStats`.

## 12.3 Restore strategy matrix

| Engine | Emptying | Foreign keys | Counters | Atomic | Locking notice |
| --- | --- | --- | --- | --- | --- |
| Postgres | One `TRUNCATE a, b, c` over the database-wide FK closure of the plan when `canTruncate`; `DELETE FROM` for any table referenced by a table outside the plan (refuses before writing when that outside table holds referencing rows) | Dependency order with two-phase insert for nullable self-references; `SET CONSTRAINTS ALL DEFERRED` when deferrable; `SET session_replication_role = replica` only when `canDisableTriggers` | `setval` per sequence to max plus one, after commit, tracked | Yes for data | `ACCESS EXCLUSIVE` on restored tables; lock wait bounded by `lock_timeout` |
| MySQL, MariaDB atomic | `DELETE FROM` inside one transaction | `SET FOREIGN_KEY_CHECKS = 0` for the session | `ALTER TABLE ... AUTO_INCREMENT = n` after commit, tracked | Yes for data | Next-key locks on every row for the duration: whole tables blocked to writers |
| MySQL, MariaDB fast | `TRUNCATE TABLE` when `canTruncate` (DROP privilege) | Same | Reset by `TRUNCATE` | No | Metadata lock per table, short |
| MongoDB | `deleteMany({})` per collection, indexes kept | Not applicable | Not applicable | No | Per operation |

Column handling on insert: generated columns skipped, identity columns inserted with `OVERRIDING SYSTEM VALUE`, partition children folded into the parent, inheritance children restored as their own units with `ONLY`, views never restored, default excluded tables (`lib/engines/pure/excluded-tables.ts`: Drizzle, Prisma, Knex, TypeORM, MikroORM, Sequelize, Flyway, Liquibase, Alembic, Django, Rails, Entity Framework history tables) unless the adapter re-includes them.

Foreign key checks toggle (edit sessions and imports, Tabular tier): off maps to `SET FOREIGN_KEY_CHECKS = 0` on MySQL and MariaDB, and on Postgres to `SET CONSTRAINTS ALL DEFERRED` when every involved constraint is deferrable, else to `session_replication_role = replica` when allowed, else the toggle is refused with the reason.

## 12.4 Type fidelity contract

| Engine | Out | In | Verified round-trips | Known gaps |
| --- | --- | --- | --- | --- |
| Postgres | `SELECT to_jsonb(t)::text FROM ONLY <table> t ORDER BY <pk>` with `SET LOCAL TIME ZONE 'UTC'` | `INSERT INTO t (cols) SELECT ... FROM jsonb_to_recordset($1::jsonb) AS r(col type, ...)` in batches of up to 1 000 rows or 65 000 parameters | bytea, numeric (including NaN and Infinity), timestamptz, arrays of composites, enums, domains, tsvector, json, jsonb, uuid, intervals | Large objects (oid references) not captured: named as warnings |
| MySQL, MariaDB | `SELECT JSON_OBJECT('c1', c1, 'c2', CAST(c2 AS CHAR), ...)` with BIGINT and DECIMAL cast to strings, ordered by primary key | Multi-row `INSERT` with parameters, batch sized under `max_allowed_packet` | bigint, decimal, datetime, timestamp, json, binary, enum, set | Spatial types round-trip as WKT text |
| MongoDB | Canonical Extended JSON per document, size measured before acceptance | `insertMany` unordered, 1 000 documents per batch, original `_id` kept | ObjectId, Date, Decimal128, Binary, Long, Regex | Documents over 16 MB when encoded are skipped with a warning |

Grid and query reads on Postgres go through the same JSON path so geometry, point, and multi-dimensional arrays display; `decodeRow` marks big integers and decimals as precise text, never a JavaScript number.

## 12.5 Interface

```ts
// Shapes named in ADR 0001; the ones callers see most:
type SnapshotOptions = { excludeTables: TableRef[]; schemas?: string[]; chunkRows?: number; signal?: AbortSignal };
type CheckoutPlan = {
  tables: ManifestTable[];                       // from state_adapters.tables
  introspectionAtSnapshot: Introspection;        // from state_adapters.introspection
  rows: (table: TableRef) => AsyncIterable<EncodedRow>;
  onDrift: "fail" | "force";
  foreignKeyChecks?: boolean;                    // default true
  lockTimeoutMs: number;
  restoreMode: "atomic" | "fast";
  signal?: AbortSignal;
};
type CheckoutResult = {
  status: "restored" | "rolled_back" | "unknown";
  strategy: RestoreStrategy;
  tables: { ref: TableRef; rows: number }[];
  skipped: { tables: TableRef[]; columns: { table: TableRef; column: string }[] };
  defaultedColumns: { table: TableRef; column: string }[];
  counters: { name: string; ok: boolean; error?: string }[];
  lockWaitMs: number; batches: number; warnings: EngineWarning[];
};
type QueryOptions = { mode: "read" | "write"; rowCap: number; byteBudget: number; timeBudgetMs: number; foreignKeyChecks?: boolean; signal?: AbortSignal };
```

## 12.6 Performance targets

| Path | Target | Source |
| --- | --- | --- |
| Snapshot throughput, Postgres | 20 MB/s gzip output on 1 GbE | 08 §8.2 |
| Restore, Postgres | 30 000 rows/s, 10-column table | 08 §8.2 |
| Restore, MySQL | measured in Sprint 0 | 08 §8.2 |
| Restore, MongoDB | measured in Sprint 0 | 08 §8.2 |
| Probe | under 2 s on a 500-table database | Estimate |
| Introspect | under 5 s on 500 tables | Estimate |
| Cancel latency | statement stops within 2 s on SQL engines; next yield point on MongoDB | Spike |
| Memory per active job | at most 2 chunks in flight per table | 08 §8.4 |

## 12.7 Sprint 0 measurements

Filled in by the throughput spike: per engine and version on the CI matrix, snapshot MB/s, restore rows/s at batch sizes 500, 1 000, 5 000, and the chosen defaults.

## 12.8 Security constraints

Decrypted configs enter `probe` and the pool and never leave: no error, event, or result carries them. `lib/netguard` runs on every physical connect inside the pool. User SQL reaches the engine only through `runQuery` on a reserved connection with the read-only transaction or the write session's privileges; identifiers Testate generates are quoted by the adapter. Cancel, list, and terminate open their own short-lived connections.

## 12.9 Component and contract

```
apps/api/src/lib/engines/
  index.ts             engine registry, DbEngine facade, pool manager
  types.ts             ADR 0001 shapes, EngineError, EngineErrorKind
  pure/                fingerprint.ts, dependency-order.ts, diff-schema.ts, strategy.ts, validate-row.ts, excluded-tables.ts
  postgres/            engine.ts, probe.ts, codec.ts, cancel.ts, reader.ts, restore.ts, query.ts
  mysql/               same, with dialect.ts for MariaDB branches
  mongodb/             engine.ts, probe.ts, codec.ts, cancel.ts, reader.ts, restore.ts, query.ts
  fake/                engine.ts (Map-backed), capabilities configurable per test
```

Locked public signatures: `DbEngine`, the pure exports, `EngineError`, and the types in §12.5 and ADR 0001. Everything under `postgres/`, `mysql/`, `mongodb/` is private.

## 12.10 What this does not do

- No schema changes on the target. Drift is detected, never migrated (PRD §6).
- No serialization of jobs per adapter; `jobs` does that ([16-jobs-runtime.md](16-jobs-runtime.md)).
- No credential handling beyond receiving a decrypted config; `lib/sealed` and `adapters` own that.
- No address policy of its own; the pool calls `lib/netguard`.
- No document import or write forms on MongoDB; the Document tier stops at view, state, diff, extract.
- No bulk-copy path; Bun's driver lacks one.

## 12.11 Cross-references

| Concern | Source |
| --- | --- |
| Interface decision and alternatives | `../adr/0001-dbengine-interface.md` |
| Restore recipe around the engine | [13-checkout-and-restore.md](13-checkout-and-restore.md) |
| Fingerprint inputs | [14-schema-fingerprint.md](14-schema-fingerprint.md) |
| Blob layout the chunks land in | [15-snapshot-store.md](15-snapshot-store.md) |
| Editing, policies, fixtures | [24-table-editing.md](24-table-editing.md) |
| Contract suite | 04 §4.6, `apps/api/test/contract/` |

## 12.12 Open follow-ups

| Item | Revisit when |
| --- | --- |
| `mysql2` fallback for MariaDB | The Sprint 0 spike fails on `mysql_native_password` or the timeout variable |
| Postgres `COPY` | Bun's driver ships `COPY`; restore throughput below target |
| MongoDB transactions per collection | A user needs atomic restore on a replica set and accepts the 60 s transaction limit |
| CockroachDB through the Postgres adapter | A user asks; needs a capability profile and `CANCEL QUERY` |
