---
name: add-db-adapter
description: Implement or extend a Testate database engine behind the DbEngine port (ADR 0001, spec 12) with the capability probe, RowText snapshots, restore strategies, read-only enforcement, and contract tests against the compose engines.
---

# Add a database engine

An engine is one folder under `apps/api/src/lib/engines/<engine>/` that implements the `DbEngine` port from `docs/adr/0001-dbengine-interface.md`. Read the ADR and `docs/technical-specs/12-engine-port.md` first; `13-checkout-and-restore.md`, `14-schema-fingerprint.md`, and `24-table-editing.md` cover the callers. Nothing in this skill overrides those documents.

## The port, in order of implementation

| Step | Method | Notes |
| --- | --- | --- |
| 1 | `probe(config, event)` | Stateless. Returns `ProbeResult`: engine, version, `meets_floor` (Postgres 13, MySQL 8.0, MariaDB 10.6, MongoDB 6.0), tier, capabilities, strategy, read-only enforcement, table count, size estimate, warnings. Below the floor: `EngineError("version_too_old")` |
| 2 | `introspect(conn, event)` | Tables, columns (name, type, nullable, default), primary keys, foreign keys in and out, unique sets, unsupported columns with a reason. Feeds `computeFingerprint` (pure) |
| 3 | `readTable`, `pageRows`, `decodeRow` | Rows leave the engine as `RowText` (server-side JSON text); `decodeRow` is pure and only for display. Keyset pagination when a primary key exists |
| 4 | `runQuery`, `listRunningQueries`, `cancelQuery` | Read mode runs in a read-only transaction (SQL) or with the read credential or filter (MongoDB). Cancel goes through a second connection (`pg_cancel_backend`, `KILL QUERY`, `killOp`) keyed by adapter and query id |
| 5 | `snapshot(conn, opts, event)` | Pull-driven `SnapshotRun`: one consistent instant per adapter (repeatable read + cursor, consistent snapshot + keyset, snapshot read concern), chunks of 5 000 rows or 8 MiB, manifest settles when drained; dispose abandons |
| 6 | `checkout(conn, plan, event)` | Push-driven `CheckoutRun`. Strategy from `selectRestoreStrategy` (pure), re-run at job start. Column-list inserts with casts; FK order from `computeDependencyOrder`; progress per table; cancel at the next batch rolls the transaction back |
| 7 | `repairCounters`, `editRow`, `writeRows` | Tabular tier only. Sequences and auto-increments after a restore; single-row edits and import batches through the same column-list path |

Inner ports each engine keeps private: `CapabilityProbe` (the seam the planner test swaps), `TypeCodec` (reused by every outer method), `CancelChannel` (outlives the request that captured it).

## Rules that do not bend

- **Read-only by construction.** The agent and viewer paths call `runQuery` in read mode; the engine enforces it where the engine can, and the probe reports how (`read_only_enforcement`).
- **No re-encoding.** Snapshot bytes are the server's JSON text. The driver's decoder never touches them. Type fidelity failures are `unsupported` columns in the introspection, not silent coercions.
- **No schema changes on the target.** Drift is detected (`diffSchema`) and refused unless forced; never migrated.
- **Typed errors.** Every driver error becomes `EngineError` with a `kind` from the closed union and typed `details`. No raw driver error escapes the engine folder.
- **Credentials arrive decrypted** from `adapters` through `lib/sealed`; the engine never reads env or stores a secret. Addresses go through `lib/netguard` before a socket opens.
- **Pool per adapter id**: 4 connections, 10-minute idle close, evicted on target or credential change. Snapshot and restore reserve one connection each.

## Wiring

1. `lib/engines/<engine>/index.ts` exports `createXEngine(): DbEngine`.
2. Register it in the engine registry keyed by the `ENGINES` value from `@testate/shared`; `adapters` resolves an engine by `adapter.engine`.
3. `capabilities.tier` decides what the modules allow; a module refuses operations outside the tier with `ENGINE_UNSUPPORTED`.
4. Add the engine to `deploy/compose.engines.yml` with a health check and an offset port.

## Tests

- Pure functions (`computeFingerprint`, `computeDependencyOrder`, `diffSchema`, `selectRestoreStrategy`, `validateImportRow`) get unit tests with hand-written introspections. Break one input and watch the test fail.
- Engine methods get contract tests beside the engine, `lib/engines/<engine>/<engine>.contract.test.ts`, tagged `contract`, run by `bun run contract` against `deploy/compose.engines.yml`. The suite is shared across engines: probe floor, introspection round-trip, snapshot-then-checkout equality by row hash, drift refusal, cancel mid-query, read-only refusal of a write.
- Sprint 0 measurements in spec 12 §12.7 are the performance baseline; a regression is a failing contract test, not a note.

## Checklist before the row moves to OK

- [ ] Probe refuses below the floor with a named fix
- [ ] Fingerprint stable across two introspections of the same schema
- [ ] Snapshot → checkout → diff shows zero changes on the sample database
- [ ] Forced checkout reports skipped and defaulted columns
- [ ] Cancel during snapshot and during checkout leaves the target unchanged
- [ ] Masks and column policies apply on `pageRows`, `runQuery`, and fixtures
- [ ] Wide event carries `engine.name`, `engine.version`, `engine.strategy`, rows, bytes, and duration
