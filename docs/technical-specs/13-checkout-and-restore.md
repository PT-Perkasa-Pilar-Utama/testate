# 13. Checkout and Restore

A checkout returns every adapter in a state to the data in that state. This document is the single source for the recipe around the engine: pre-flight, stash, drift, force, per-adapter execution, counters, hooks, HEAD, retry, and the return-to-init variant that project and adapter deletion use. Cite it; do not restate it.

## 13.1 Decision matrix

| Concern | Decision | Rationale |
| --- | --- | --- |
| Unit of work | One checkout job per project; adapters restored in parallel under the global cap, each with its own result | Story 77: per-adapter results, HEAD unknown on any failure, retry of failed adapters |
| Stash | Always, before anything else, kind `stash`, reason `checkout`; skipped only for return-to-init | Story 73; a stash before deleting has no home |
| Drift | `diffSchema(state.introspection, live)` per adapter; refuse with `SCHEMA_DRIFT` unless `force` | Story 74, 75 |
| Force | Restore the intersection of tables and columns; report skipped tables, skipped columns, and live columns that received defaults | Story 75 |
| Strategy | `selectRestoreStrategy` at job start from a fresh probe; shown in pre-flight; degraded, never failed, on a revoked privilege | Story 79 |
| Partial states | Adapters not in the state stay untouched and are reported `skipped`; removed adapters likewise | Story 76 |
| Counters | Post-commit tracked step per adapter; failure leaves `counters_failed` with a repair action; HEAD unknown until repaired | Story 78; `setval` does not roll back; `ALTER TABLE` commits implicitly |
| Lock wait | `lock_timeout` from the adapter (default 60 s); failure `CHECKOUT_BLOCKED` with blocking sessions; terminate option only when the probe proved the privilege | Story 82 |
| Hooks | `before_checkout` after the stash, `after_checkout` after counters; `abort` policy fails the job before any restore when it fires in `before_checkout` | Story 98, 99 |
| HEAD | Moves to the state when every adapter is `restored`; `unknown` otherwise | Story 77, 104 |
| Retry | `POST .../checkouts/{id}/retry` re-runs adapters not in `restored`, same stash, same plan | Story 77 |
| Return to init | Same recipe with `purpose: return_to_init`, no stash, plan from the deletion plan, hooks run, results per adapter | PRD §4.5 |

## 13.2 The job, step by step

```text
checkout job (project P, state S, force F, adapters A = S.adapters ∩ P.adapters ∩ requested)
 1. validate: P has no running job on any adapter in A            -> JOB_IN_PROGRESS
 2. stash: states.stash(P, "checkout")                             -> stash id on the checkout row
 3. hooks.run("before_checkout")                                   -> abort policy fails here, nothing touched
 4. for each adapter a in A, in parallel under the cap:
      probe(a)                                                     -> capabilities, strategy (degrade if needed)
      live = introspect(a)
      drift = diffSchema(S.introspection[a], live)
      if drift.changed and not F                                   -> result rolled_back? no: result "skipped", error SCHEMA_DRIFT (nothing touched)
      plan = { tables: F ? intersect(S.tables[a], live) : S.tables[a], rows: blobstore streams, onDrift, lockTimeout, restoreMode }
      run = engine.checkout(a, plan)                               -> progress to job.progress and SSE
      result = await run.result                                    -> restored | rolled_back | unknown
      counters step inside engine.checkout after commit            -> counters_failed when it fails
      record checkout_adapters row
 5. hooks.run("after_checkout")                                    -> results attached; abort policy marks the job partial
 6. HEAD: every adapter restored -> at_state(S); else unknown
 7. job status: succeeded | partial | failed | cancelled
```

Drift refusal happens per adapter before that adapter is emptied; other adapters proceed. A checkout where one adapter refused on drift is `partial` with HEAD unknown, which is the honest state: some databases are at S, one is not.

## 13.3 Interface

```ts
// checkouts.service.ts
preflight(actor, slug, stateRef, { force }): Promise<{
  adapters: Array<{
    adapterId; name; engine; included: boolean; removed: boolean;
    drift: SchemaDrift | null; strategy: RestoreStrategy; atomic: boolean; lockingNotice: string;
    forcePreview?: { skippedTables: TableRef[]; skippedColumns: ColumnRef[]; defaultedColumns: ColumnRef[] };
  }>;
  stashWillBeTaken: boolean;
}>;
create(actor, slug, { stateId?; stateName?; force?; adapterIds? }, event): Promise<{ checkout; job }>;
retryFailed(actor, slug, checkoutId, event): Promise<{ checkout; job }>;
returnToInit(slug, plan: Array<{ adapterId; action: "restore" | "force" | "skip"; reason? }>, event): Promise<AdapterResult[]>;
```

`POST /api/v1/projects/{slug}/checkouts` body: `{ "state_id" | "state_name", "force": false, "adapter_ids": [...] }`, response `202 { data: { checkout, job } }`, `Location: /api/v1/jobs/{id}`.

## 13.4 Postgres execution detail

1. Reserve a connection; `SET lock_timeout = <ms>`; `SET LOCAL TIME ZONE 'UTC'`; `BEGIN`.
2. `SET CONSTRAINTS ALL DEFERRED` when deferrable constraints exist; `SET LOCAL session_replication_role = replica` when allowed.
3. Compute the truncate set: the plan's tables plus every table that references them transitively through foreign keys. Tables in that closure but outside the plan and not excluded are refused before this point (pre-flight names them). Excluded tables that reference plan tables: if they hold referencing rows, refuse before writing; if empty, they join the `TRUNCATE` list.
4. `TRUNCATE t1, t2, ... ` in one statement when `canTruncate`; otherwise `DELETE FROM` in reverse dependency order.
5. Insert in dependency order, column-list inserts from introspection, batches of up to 1 000 rows, two-phase for nullable self-references, `OVERRIDING SYSTEM VALUE` on identity columns.
6. `COMMIT`.
7. Counters: `SELECT setval(seq, COALESCE(max(col), 0) + 1, false)` for every sequence owned by a restored column; each recorded.
8. `REFRESH MATERIALIZED VIEW` for each materialized view the adapter option lists.

Cancel: the abort signal is checked between batches; an engine-level `pg_cancel_backend` from a second connection interrupts a blocked `TRUNCATE` or a long insert, and the transaction rolls back.

## 13.5 MySQL and MariaDB execution detail

Atomic mode (default): reserve; `SET SESSION FOREIGN_KEY_CHECKS = 0`; `SET SESSION innodb_lock_wait_timeout = <s>`; `START TRANSACTION`; `DELETE FROM` each table; multi-row inserts sized under `max_allowed_packet`; `COMMIT`; then `ALTER TABLE ... AUTO_INCREMENT = max + 1` per table, tracked. Non-InnoDB tables are restored outside the transaction and reported in the atomicity notice.

Fast mode (needs DROP): `TRUNCATE TABLE` per table before the inserts; not atomic; counters reset by `TRUNCATE`.

Lock wait: `innodb_lock_wait_timeout` maps to `CHECKOUT_BLOCKED`; blocking sessions from `performance_schema.data_lock_waits` when readable, else empty.

## 13.6 MongoDB execution detail

Per collection: `deleteMany({})` then `insertMany(batch, { ordered: false })` with original `_id`. Views are skipped. Time-series collections: `deleteMany({})` is allowed from 7.0; below it the adapter reports the collection `skipped` with a warning. No atomicity; the notice says so; cancel between batches plus `killOp` on the running operation.

## 13.7 Return to init

Input: the deletion plan (per adapter: `restore`, `force`, `skip` with reason). For each `restore` or `force` adapter, the recipe from §13.2 runs with `purpose: return_to_init`, the adapter's current init state (the latest `init` kind state for that adapter id), no stash, hooks included. The deletion job removes anything only after every non-skipped adapter reports `restored`. A failure leaves everything, sets HEAD unknown on the failed adapters, and the job offers retry.

## 13.8 Performance targets

| Path | Target | Source |
| --- | --- | --- |
| Pre-flight | under 5 s per adapter (probe plus introspect plus diff) | 12 §12.6 |
| Restore throughput | per 12 §12.6 | Spike |
| Stash cost | one snapshot; dedup makes an unchanged database near free | 15 |
| Hook budget | adapter timeout each, sequential in position order | 10 §10.4 |

## 13.9 Security constraints

`qa` role, `sandbox` adapter, project scope. Force is audited as `checkout.forced`. Terminate blocking sessions is a separate confirmation with its own audit action and requires `canTerminateSessions`.

## 13.10 Component and contract

`modules/checkouts/`: `checkouts.preflight.ts`, `checkouts.job.ts`, `checkouts.return-to-init.ts`, `checkouts.service.ts`, `checkouts.repository.ts`. Locked: the `preflight` and `create` shapes above and the `checkout_adapters.result` enum (06 §6.9).

## 13.11 What this does not do

- No schema repair; drift is a refusal, force is an intersection.
- No cross-adapter atomicity; each adapter is its own transaction or best effort.
- No automatic terminate of blocking sessions; always an explicit action.
- No hooks on `return_to_init` skips.

## 13.12 Cross-references

| Concern | Source |
| --- | --- |
| Engine strategy matrix | [12-engine-port.md](12-engine-port.md) §12.3 |
| Drift inputs | [14-schema-fingerprint.md](14-schema-fingerprint.md) |
| Stash and states | 05 §5.8, [15-snapshot-store.md](15-snapshot-store.md) |
| Jobs, cancel, recovery | [16-jobs-runtime.md](16-jobs-runtime.md) |
| Deletion plan | 05 §5.4, §5.5 |

## 13.13 Open follow-ups

| Item | Revisit when |
| --- | --- |
| Terminate blocking sessions automatically on `sandbox` adapters | Users ask after seeing repeated `CHECKOUT_BLOCKED` on a dev box |
| Parallel table inserts inside one adapter | Restore throughput misses target and the engine allows it |
