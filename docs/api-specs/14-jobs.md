# 14. Jobs

Module: `jobs` ([../technical-specs/05-module-definitions.md §5.14](../technical-specs/05-module-definitions.md)). Runtime: [16](../technical-specs/16-jobs-runtime.md).

## 14.1 Job object

```json
{ "id": "01J...", "kind": "checkout", "status": "running", "queue_position": null,
  "project_id": "01J...", "adapter_ids": ["01J..."],
  "progress": { "phase": "restore", "adapters": { "01J...": { "table": "public.orders", "rows": 120433, "tables_done": 12, "tables_total": 42 } } },
  "result": null, "error": null, "cancel_requested": false,
  "actor": { "kind": "token", "label": "token:ci-shop" }, "parent_request_id": "01J...",
  "created_at": "...", "started_at": "...", "finished_at": null }
```

Kinds and statuses: [06 §6.6](../technical-specs/06-data-model.md). `result` and `error` are set on terminal statuses; `error` is `{ "code", "message", "details" }` using the codes in 01 §1.6.

## 14.2 `GET /jobs`

**Access.** `viewer` (scope-filtered; instance-level jobs for `admin`). **Input.** Query: `cursor`, `limit`, `project_id`, `adapter_id`, `kind`, `status`, `q` (substring match against kind, status, or actor label), `created_from`, `created_to`, `sort` (`created_at`, `kind`, or `status`), `order`. **Output.** `200` list. **Traceability.** Story 106.

## 14.3 `GET /jobs/{id}`

**Access.** `viewer`. **Input.** Query: `wait` 1 to 300 seconds optional. **Behavior.** With `wait`, block until terminal or timeout. **Output.** `200` when terminal (or without `wait`), `202` when still running after `wait`. **Errors.** `NOT_FOUND`. **Traceability.** Stories 104, 113.

## 14.4 `POST /jobs/{id}/cancel`

**Purpose.** Ask a job to stop (story 105). **Access.** `qa` for own jobs; `admin` for any. **Behavior.** Sets `cancel_requested`; the runner stops between batches and the engine statement in flight is cancelled from a second connection; the final status is `cancelled` when acknowledged. **Output.** `202` job. **Errors.** `CONFLICT` (terminal), `FORBIDDEN`, `NOT_FOUND`. **Traceability.** Story 105.

## 14.5 `GET /jobs/{id}/events`

**Purpose.** Live progress over server-sent events (story 104).

**Access.** `viewer`, cookie or bearer.

**Behavior.** `Content-Type: text/event-stream`; events `progress` (the `progress` object), `status` (the job with its new status; terminal statuses close the stream), `heartbeat` every 15 s. Opening without `Last-Event-ID` replays the latest `status` frame first. Opening with `Last-Event-ID` set suppresses that replay when the id is at or past the latest status's id; a lower id still replays it. nginx must disable buffering on this path.

```text
event: progress
id: 42
data: {"phase":"restore","adapters":{...}}

event: status
id: 43
data: {"id":"01J...","status":"succeeded","result":{...}}
```

**Errors.** `NOT_FOUND` before the stream opens. **Traceability.** Story 104.
