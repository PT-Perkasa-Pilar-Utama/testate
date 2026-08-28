# 9. Checkouts

Module: `checkouts` ([../technical-specs/05-module-definitions.md §5.9](../technical-specs/05-module-definitions.md)). Recipe: [13](../technical-specs/13-checkout-and-restore.md). All paths under `/projects/{slug}`.

Checkout object:

```json
{ "id": "01J...", "state": { "id": "01J...", "name": "seeded-baseline" }, "job_id": "01J...",
  "stash_state_id": "01J...", "force": false, "purpose": "checkout", "status": "partial",
  "adapters": [ { "adapter_id": "01J...", "name": "orders-db", "engine": "postgres", "result": "restored", "strategy": {...}, "rows": 120433, "duration_ms": 17210, "lock_wait_ms": 0,
                  "skipped_tables": [], "skipped_columns": [], "defaulted_columns": [], "error": null },
                { "adapter_id": "01J...", "name": "events-db", "engine": "mongodb", "result": "unknown", "error": { "code": "ADAPTER_UNREACHABLE", "message": "..." } } ],
  "actor": { "kind": "token", "label": "token:ci-shop" }, "created_at": "...", "finished_at": "..." }
```

## 9.1 `POST .../checkouts/preflight`

**Purpose.** Show what a checkout will do before confirming (stories 77, 78, 82, 84).

**Access.** `qa`.

**Input.** Body: `state_id` or `state_name` (exactly one); `force` boolean, default false; `adapter_ids` optional.

**Behavior.** Resolve the state; for each adapter in the state: probe, introspect, `diffSchema`, `selectRestoreStrategy`; include atomicity and locking notice; removed adapters reported `included: false, removed: true`.

**Output.** `200 { "data": { "state": {...}, "stash_will_be_taken": true, "adapters": [ { "adapter_id", "name", "engine", "included": true, "removed": false, "drift": { "changed": true, "tables": { "added": [], "removed": [] }, "columns": { "added": [ { "table": "public.orders", "column": "channel" } ], "removed": [], "type_changed": [], "nullability_changed": [] } }, "strategy": {...}, "atomic": true, "locking_notice": "Restored tables take an exclusive lock for the duration.", "force_preview": { "skipped_tables": [], "skipped_columns": [], "defaulted_columns": [ { "table": "public.orders", "column": "channel" } ] } } ] } }`.

**Errors.** `NOT_FOUND` (state), `VALIDATION_ERROR` (both or neither state fields), `ADAPTER_UNREACHABLE`. **Traceability.** Stories 77, 78, 79, 82, 84.

## 9.2 `POST .../checkouts`

**Purpose.** Restore a state (story 75); the CI entry point (story 113).

**Access.** `qa`; every included adapter `sandbox`.

**Input.** Body: `state_id` or `state_name` (exactly one); `force` boolean; `adapter_ids` optional. Headers: `Idempotency-Key`. Query: `wait`.

**Behavior.** Per [13 §13.2](../technical-specs/13-checkout-and-restore.md): claim adapters (`JOB_IN_PROGRESS`), create the checkout row, enqueue job `checkout`; the job stashes (story 76), runs `before_checkout` hooks, restores each adapter in parallel with drift refusal unless force (stories 77, 78), records per-adapter results (story 80), resets counters as a tracked step (story 81), runs `after_checkout` hooks, moves HEAD or sets it unknown. Audit `checkout.created`, plus `checkout.forced` when `force`.

**Output.** `202 { "data": { "checkout": {...}, "job": {...} } }`; with `wait` and a terminal job, `200` with the finished checkout.

**Errors.** `ADAPTER_READ_ONLY`, `JOB_IN_PROGRESS`, `NOT_FOUND`, `VALIDATION_ERROR`, `CONFLICT` (idempotency mismatch). Job-level failures appear on the checkout: `SCHEMA_DRIFT` per adapter (result `skipped`, error code), `CHECKOUT_BLOCKED` (result `rolled_back`, `details.blocking_sessions`, `details.terminable`). **Traceability.** Stories 75 to 87, 113, 115.

## 9.3 `GET .../checkouts` and `GET .../checkouts/{id}`

**Purpose.** History and detail (story 87). **Access.** `viewer`. **Input.** Query: `cursor`, `limit`, `status`, `state_id`, `purpose`. **Output.** `200` list or object. **Traceability.** Story 87.

## 9.4 `POST .../checkouts/{id}/retry`

**Purpose.** Re-run the adapters that did not reach `restored` (story 80). **Access.** `qa`. **Behavior.** Same stash, same state, same force flag; only adapters with result other than `restored` and `skipped`-by-drift; new job; the checkout row is updated in place; audit `checkout.retried`. **Output.** `202 { "data": { "checkout", "job" } }`. **Errors.** `CONFLICT` (nothing to retry, checkout still running), `JOB_IN_PROGRESS`, `NOT_FOUND`. **Traceability.** Story 80.

## 9.5 `POST .../checkouts/{id}/terminate-blockers`

**Purpose.** Terminate the sessions that blocked a checkout, when the probe allows (story 85). **Access.** `qa`. **Input.** Body: `adapter_id` required; `session_ids` string[] required (from `details.blocking_sessions`). **Behavior.** Requires `capabilities.canTerminateSessions` (`ENGINE_UNSUPPORTED` otherwise); issues the engine's terminate; audit `checkout.blockers_terminated`; the caller then retries (9.4). **Output.** `200 { "data": { "terminated": ["12345"], "failed": [] } }`. **Errors.** `ENGINE_UNSUPPORTED`, `NOT_FOUND`. **Traceability.** Story 85.

## 9.6 `GET .../checkouts/{id}/counters`  and `POST .../checkouts/{id}/repair-counters`

**Purpose.** Show and repair the counters step (story 81). **Access.** `viewer` reads; `qa` repairs. **Behavior.** Repair calls `repairCounters` for adapters with result `counters_failed`; success sets the result to `restored` and re-evaluates HEAD. **Output.** `200 { "data": { "adapters": [ { "adapter_id", "counters": [ { "name": "orders_id_seq", "ok": true } ] } ] } }`. **Errors.** `CONFLICT` (nothing to repair), `NOT_FOUND`. **Traceability.** Story 81.
