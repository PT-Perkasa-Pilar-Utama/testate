# 21. Wide-Event Logging

Testate logs one wide event per request and one per job, after https://loggingsucks.com/. This document is the single source for the event shape, the API modules use to add context, sampling, the file sink and its 30-day rolling window, and redaction. The `wide-event-logging` skill in `.claude/skills/` is the agent-facing summary of this document and cites it; when they disagree, this document wins.

## 21.1 Decision matrix

| Concern | Decision | Rationale |
| --- | --- | --- |
| Unit | One event per request, emitted after the response; one per job, emitted at the terminal status; one at boot and one at shutdown | loggingsucks: one wide event per unit of work |
| Shape | JSON object, flat keys `ts`, `kind`, `level`, `sampled`; nested sections `service`, `request` or `job`, `actor`, `project`, `adapter`, `op`, `engine`, `error` | Queryable by section |
| Building | Handlers, services, drivers add to the event passed down; nothing prints | Rule 2 of the pattern |
| Level | Derived: `error` when `error` present or status 500 and up; `warn` for 4xx and `partial`; else `info` | No hand-set levels |
| Sampling | Tail: keep every `error` and `warn`, every request over `TESTATE_LOG_SLOW_MS`, every job; keep the rest at `TESTATE_LOG_SAMPLE_RATE` (default 1.0) with per-route overrides in `settings.log.sample_rate_by_route` | Volume is small; 30 days bounds cost |
| Sink | `${TESTATE_LOG_DIR}/testate-YYYY-MM-DD.jsonl`, UTC days, one line per event, rotation on the first write after midnight UTC | Owner request: file, 30-day rolling window |
| Retention | Files older than `TESTATE_LOG_RETENTION_DAYS` deleted at boot and once a day | Rolling window |
| Stdout | Mirror on by default (`TESTATE_LOG_STDOUT`), same lines | `docker logs` and the file agree |
| Writer | One serialized appender; a failed write falls back to stdout and sets `service.sink_degraded` | Never lose an error event silently |
| Redaction | Structural: sealed values, passwords, tokens, session ids, rows, file bodies, and query text are not accepted by the event API; query text is represented by `query_hash` and `query_bytes` | No secrets in logs |
| Correlation | `request.id` from `X-Request-Id` (trusted proxy) or UUID v7; jobs carry `parent_request_id`; every event carries `service.boot_id` | Trace a checkout from the CI call to the restore |
| Package | In-house (`lib/logger`); `hono-wide-logger` not used | It covers only the HTTP half |

## 21.2 Event shape

```json
{
  "ts": "2026-08-28T10:23:45.612Z", "kind": "request", "level": "warn", "sampled": true,
  "service": { "name": "testate", "version": "1.2.0", "boot_id": "01J...", "base_path": "/", "sink_degraded": false },
  "request": { "id": "01J...", "method": "POST", "path": "/api/v1/projects/shop/checkouts", "route": "/projects/:slug/checkouts",
               "status": 409, "duration_ms": 41, "client_ip": "10.0.4.7", "user_agent": "curl/8.7",
               "bytes_in": 88, "bytes_out": 412, "idempotency_key_hash": "9f3c..." },
  "actor": { "user_id": null, "role": "qa", "token_id": "01J...", "auth": "token", "agent": false },
  "project": { "id": "01J...", "slug": "shop" },
  "adapter": { "id": "01J...", "kind": "database", "engine": "mysql", "engine_version": "8.4.2", "mode": "sandbox" },
  "op": { "name": "checkout", "state_id": "01J...", "state_name": "seeded-baseline", "force": false, "job_id": null },
  "error": { "code": "SCHEMA_DRIFT", "type": "DriftError", "message": "2 tables differ", "retriable": false,
             "details": { "tables": ["orders", "order_items"] } }
}
```

Job event: `kind: "job"`, section `job` `{ id, kind, status, queued_ms, duration_ms, parent_request_id, cancel_requested }`, `op` with a per-adapter array, `engine` `{ strategy, lock_wait_ms, batches, counters_reset, warnings }`.

| Section | Filled by | Fields |
| --- | --- | --- |
| `service` | logger | `name`, `version`, `boot_id`, `base_path`, `sink_degraded` |
| `request` | middleware | `id`, `method`, `path`, `route`, `status`, `duration_ms`, `client_ip`, `user_agent`, `bytes_in`, `bytes_out`, `idempotency_key_hash` |
| `job` | dispatcher | `id`, `kind`, `status`, `queued_ms`, `duration_ms`, `parent_request_id`, `cancel_requested` |
| `actor` | auth middleware | `user_id`, `role`, `token_id`, `auth`, `agent` |
| `project`, `adapter` | handler or runner | ids, slug, name, engine, version, mode |
| `op` | service or runner | `name`, ids and names acted on, counts, bytes, `adapters[]`, `query_hash`, `query_bytes`, `rows`, `mode` |
| `engine` | driver | `strategy`, `lock_wait_ms`, `batches`, `counters_reset`, `cancelled`, `warnings` |
| `error` | `event.error()` | `code`, `type`, `message`, `retriable`, `details`, `stack` only with `TESTATE_LOG_STACKS` |

## 21.3 Interface

```ts
// lib/logger/index.ts
type WideEvent = {
  add(section: Section, fields: Fields): void;          // replace
  merge(section: Section, fields: Fields): void;        // deep merge
  push(path: `${Section}.${string}`, item: Fields): void;   // append to an array
  error(cause: unknown, extra?: { code?: string; retriable?: boolean; details?: Fields }): void;
  emit(): void;                                         // idempotent
};
createEvent(kind: "request" | "job" | "boot" | "shutdown"): WideEvent;
wideEvent(): MiddlewareHandler;                         // sets c.var.event, emits in finally
```

`Fields` rejects functions, `Sealed` values, and any object that carries a `__sealed`, `password`, `token`, or `secret` key; a rejected field throws in development and test and is dropped with a `service.redaction_dropped` counter in production.

## 21.4 Sink and rotation

```text
write(line):
  day = ts.slice(0, 10)
  if day != currentDay: close current; open logs/testate-<day>.jsonl (append); currentDay = day; sweep()
  append line + "\n"; on failure: stdout.write(line); service.sink_degraded = true
sweep():
  for each logs/testate-*.jsonl older than TESTATE_LOG_RETENTION_DAYS by file date: unlink; count into the next boot or sweep event
```

Boot runs `sweep()` once; the daily retention timer runs it again with the other sweeps.

## 21.5 Performance targets

| Path | Target | Source |
| --- | --- | --- |
| Emit cost | under 0.2 ms per event, off the request's critical path (after the response is sent) | Design |
| Throughput | 1 000 events/s sustained on the appender | Estimate |
| File size | at 1 000 requests/day and 2 KiB per event, about 2 MiB/day; 60 MiB for 30 days | Arithmetic |

## 21.6 Security constraints

Log files are readable only by the container user. Events never carry credentials, rows, query text, or session identifiers. `client_ip` is the first `X-Forwarded-For` address only when the proxy is trusted. The audit log is the durable record; wide events expire.

## 21.7 Component and contract

`lib/logger/{index.ts, event.ts, sink.ts, sampling.ts, redact.ts}`. Locked: the section names, the flat keys, the file naming, and the rule that no `console.*` exists outside `lib/logger` (lint `no-console` with that one allow).

## 21.8 What this does not do

- No log shipping; mount or tail the directory.
- No metrics; counts are queries over the files.
- No per-step log lines; a step that matters becomes a field.
- No PII scrubbing beyond the structural rules; row data never enters an event.

## 21.9 Cross-references

| Concern | Source |
| --- | --- |
| Agent-facing rules | `.claude/skills/wide-event-logging/SKILL.md` |
| Audit versus log | 05 §5.13 |
| Request id and proxy | 10 §10.4 |
| Environment | 11 §11.1 |

## 21.10 Open follow-ups

| Item | Revisit when |
| --- | --- |
| Compressed daily files | Disk on `/data` becomes a concern |
| OpenTelemetry export | An organization runs a collector and asks |
