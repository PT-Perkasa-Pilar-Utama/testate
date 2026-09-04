---
name: wide-event-logging
description: Testate's logging rule, after loggingsucks.com. One wide event per request and one per job, JSON, nested sections, built during the lifecycle and emitted once, written to a daily file with 30-day retention. Use whenever you add or change a route, a job kind, a hook run, an engine operation, an error path, or whenever you are about to write console.log, a per-step log line, or a new logger.
---

# Wide-event logging in Testate

Testate does not log lines. It logs events. A request produces one event when it finishes. A job produces one event when it reaches a terminal status. Everything an operator would grep for lives inside that one event, as nested sections, so a question like "every failed checkout on MySQL adapters in the last day, by error code" is one filter over one file.

Source of the pattern: https://loggingsucks.com/. Source of truth for Testate's shape, sink, and sampling: `docs/technical-specs/21-wide-event-logging.md`; when this skill and that document disagree, the document wins. Testate implements it in `apps/api/src/lib/logger/` without the `hono-wide-logger` package, because the package covers only the HTTP half, defaults to `console`, and knows nothing about files, rotation, or jobs.

## The rule

1. **One event per unit of work.** Request: created by the `wideEvent()` middleware, emitted in `finally` after the response is written. Job: created by the dispatcher when the job starts, emitted when the job is `succeeded`, `failed`, `cancelled`, `partial`, or `interrupted`. Boot and shutdown emit one event each.
2. **Build, do not print.** Handlers, services, and job runners add context to the current event. They never print. `console.log`, `console.error`, and ad hoc loggers are lint errors outside `lib/logger/`.
3. **Sections, not flat keys.** Every field lives in a named section. Flat top-level keys are `ts`, `kind`, `level`, `sampled`.
4. **Redaction is structural.** An event never carries a sealed value, a password, a token, a session id, a row, a file body, or query text. It carries ids, names, counts, bytes, hashes, durations, and codes. The sealed-value types are not serializable; the logger throws if one reaches it.
5. **Emit once.** `event.emit()` is idempotent; a second call is ignored and counted.

## Event shape

```json
{
  "ts": "2026-08-28T10:23:45.612Z",
  "kind": "request",
  "level": "error",
  "sampled": true,
  "service": { "name": "testate", "version": "1.0.0", "boot_id": "01J...", "base_path": "/testate" },
  "request": { "id": "01J...", "method": "POST", "path": "/api/v1/projects/shop/checkouts", "route": "/projects/:slug/checkouts", "status": 409, "duration_ms": 41, "client_ip": "10.0.4.7", "user_agent": "curl/8.7", "bytes_in": 88, "bytes_out": 412, "idempotency_key_hash": "9f3c..." },
  "actor": { "user_id": "01J...", "role": "qa", "token_id": null, "auth": "session" },
  "project": { "id": "01J...", "slug": "shop" },
  "adapter": { "id": "01J...", "kind": "database", "engine": "mysql", "engine_version": "8.4.2", "mode": "sandbox" },
  "op": { "name": "checkout", "state_id": "01J...", "state_name": "seeded-baseline", "force": false, "job_id": null },
  "error": { "code": "SCHEMA_DRIFT", "type": "DriftError", "message": "2 tables differ", "retriable": false, "details": { "tables": ["orders", "order_items"] } }
}
```

A job event has `kind: "job"` and, instead of `request`, a `job` section plus richer `op` and `engine` sections:

```json
{
  "kind": "job",
  "job": { "id": "01J...", "type": "checkout", "status": "succeeded", "queued_ms": 120, "duration_ms": 18400, "parent_request_id": "01J...", "cancel_requested": false },
  "op": {
    "name": "checkout", "state_id": "01J...", "state_name": "seeded-baseline", "stash_state_id": "01J...",
    "adapters": [
      { "id": "01J...", "engine": "postgres", "result": "restored", "tables": 42, "rows": 120433, "bytes": 8123001, "duration_ms": 17210 }
    ],
    "hooks": [ { "id": "01J...", "trigger": "after_checkout", "status": 200, "duration_ms": 310, "policy": "continue" } ]
  },
  "engine": { "strategy": "dependency_order", "lock_wait_ms": 0, "batches": 118, "counters_reset": 12, "warnings": [] }
}
```

| Section | Who fills it | Fields |
| --- | --- | --- |
| `service` | logger | `name`, `version`, `boot_id`, `base_path` |
| `request` | middleware | `id`, `method`, `path`, `route` (matched pattern, low cardinality), `status`, `duration_ms`, `client_ip`, `user_agent`, `bytes_in`, `bytes_out`, `idempotency_key_hash` |
| `job` | dispatcher | `id`, `type`, `status`, `queued_ms`, `duration_ms`, `parent_request_id`, `cancel_requested` |
| `actor` | auth middleware | `user_id`, `role`, `token_id`, `auth` (`session` or `token`) |
| `project` | handler or job runner | `id`, `slug` |
| `adapter` | handler or job runner | `id`, `kind`, `engine`, `engine_version`, `mode` |
| `op` | service or job runner | `name`, ids and names of the things acted on, counts, bytes, per-adapter and per-hook arrays |
| `engine` | engine driver | `strategy`, `lock_wait_ms`, `batches`, `counters_reset`, `cancelled`, `warnings` |
| `error` | `event.error(err)` | `code`, `type`, `message`, `retriable`, `details`; `stack` only when `TESTATE_LOG_STACKS=true` |

`level` is derived, never set by hand: `error` when `error` is present or status is 500 or higher, `warn` for 4xx and `partial` jobs, `info` otherwise.

## How to add context

```ts
// handler: the event rides on the Hono context
const event = c.get("event");
event.add("project", { id: project.id, slug: project.slug });
event.add("op", { name: "checkout", state_id: state.id, state_name: state.name, force: body.force });

// service or engine driver: the event is passed in, never looked up globally
export async function restore(plan: RestorePlan, event: WideEvent): Promise<void> {
  event.add("engine", { strategy: plan.strategy });
  ...
  event.merge("engine", { batches, lock_wait_ms });   // merge deepens an existing section
}

// error path: record and rethrow; the middleware or dispatcher emits
} catch (cause: unknown) {
  event.error(cause, { code: "ADAPTER_UNREACHABLE", retriable: true });
  throw cause;
}
```

`add` replaces a section; `merge` deep-merges into it; `push("op.adapters", item)` appends to an array. All three refuse a sealed value or a function.

## Correlation

- `request.id` comes from the `x-request-id` header when present, else a UUID v7. It goes back in the response header.
- A job stores the `request.id` of the call that created it and logs it as `job.parent_request_id`. Hook runs inside a job are elements of `op.hooks`, not separate events.
- Boot events carry `service.boot_id`; every later event carries the same `boot_id`, so a restart is visible in the file.

## Sampling

Tail sampling, decided at emit time, after the outcome is known:

- Every event with `level` `error` or `warn` is kept.
- Every request slower than `TESTATE_LOG_SLOW_MS` (default 2000) is kept.
- Every job event is kept.
- Other request events are kept at `TESTATE_LOG_SAMPLE_RATE` (default 1.0). Lower it per route in settings for the hot read paths (grid paging, job events, health) when a file grows past what 30 days should hold.

`sampled: false` events are counted, not written, and the count appears in the next boot event.

## Sink and retention

- File: `${TESTATE_LOG_DIR}/testate-YYYY-MM-DD.jsonl` (default `/data/logs`), one JSON object per line, dates in UTC. Rotation happens on the first write after midnight UTC.
- Retention: files older than `TESTATE_LOG_RETENTION_DAYS` (default 30) are deleted at boot and once a day. The sweep logs what it deleted in the boot or sweep event.
- Stdout mirror: on by default (`TESTATE_LOG_STDOUT=true`), same lines, so `docker logs` and the file agree. Turn it off when nginx or compose already ships the file.
- Writes are appended through one serialized writer; a failed write falls back to stdout and sets `service.sink_degraded` on later events.
- The audit log is not the wide-event log. Audit rows are the durable, queryable record of who did what and live in the metadata database with their own retention; wide events are operational and expire.

## What not to do

| Do not | Do |
| --- | --- |
| `console.log("restoring table", name)` | `event.merge("engine", { current_table: name })` only if it matters after the fact; otherwise nothing |
| One line per table restored | `op.adapters[n].tables` count plus `engine.batches` |
| Log the SQL a user ran | `op.query_hash`, `op.query_bytes`, `op.rows`, `op.mode` |
| Log a connection string, even redacted | `adapter.id`, `adapter.engine`, `adapter.engine_version` |
| Create a second logger for a module | Pass the `WideEvent` down |
| Emit early "started" events | Set `job.queued_ms` and `duration_ms` on the final event |

## Checklist for a new route or job kind

- [ ] The handler adds `project` and `adapter` sections when it resolves them.
- [ ] The service adds an `op` section with a `name` and the ids it acts on.
- [ ] Engine and blob-store calls receive the event and fill `engine`.
- [ ] Every catch calls `event.error` before rethrowing.
- [ ] No `console.*` outside `lib/logger/`; lint passes.
- [ ] The smoke run shows one line per request and one per job in `/data/logs`.
