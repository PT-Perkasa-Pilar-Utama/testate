# 16. Jobs Runtime

Every long operation is a job: persisted, dispatched in-process, observable over server-sent events, waitable, cancellable, and recovered after a restart. This document is the single source for the dispatcher, the cap and exclusivity rules, queue position, `wait`, idempotency, cancel, progress, retention, and boot recovery. Cite it; do not restate it.

## 16.1 Decision matrix

| Concern | Decision | Rationale |
| --- | --- | --- |
| Persistence | `jobs` table in the metadata database; the queue is `status = queued` ordered by `created_at` | Survives restarts; no second store |
| Dispatcher | One loop, tick every 500 ms, runs jobs as concurrent tasks up to `TESTATE_JOB_CONCURRENCY`; each task wrapped so one rejection never affects another | Story 101; PRD §4.10 |
| Exclusivity | A job that names an adapter already in a `queued` or `running` job is refused at enqueue with `JOB_IN_PROGRESS` 409; project-level jobs (project delete, backup, storage migration) claim every adapter in scope | Story 83 |
| Queueing | A job beyond the global cap waits with `queue_position` (count of earlier queued jobs plus one) exposed on the job and over SSE | Story 101; distinct from the adapter conflict, which never queues |
| Progress | Runner writes `progress` JSON in batches (at most every 250 ms per job) and the dispatcher pushes SSE events | 08 §8.2 |
| `wait` | `?wait=<1..300>` on job-creating POSTs and on `GET /jobs/{id}`: long-poll until terminal or timeout, then the current job; `202` while running, `200` when terminal | Story 109 |
| Idempotency | `Idempotency-Key` header, SHA-256, scoped per token, 24 h; the same job is returned; a different body with the same key is `CONFLICT` | Story 111 |
| Cancel | Sets `cancel_requested`; the runner checks between batches and calls the engine cancel for the statement in flight; `cancelled` only when the runner acknowledges | Story 102 |
| Recovery | At boot every `running` job becomes `interrupted`; checkout, import, deletion restore, and counters steps set HEAD unknown; pins released; uploads deleted | Story 104 |
| Retention | Terminal jobs older than `retention.job_history_days` are deleted by the daily sweep; jobs referenced by checkouts, states, or diffs keep a stub row (`payload` and `progress` cleared) | Story 116 |
| Kinds | `snapshot`, `checkout`, `import`, `diff`, `state_delete`, `adapter_delete`, `project_delete`, `archive_import`, `storage_migration`, `backup` | PRD §2.2 |

## 16.2 Interface

```ts
// jobs.service.ts
type JobRunner = (ctx: { job: Job; event: WideEvent; signal: AbortSignal; progress: (p: JobProgress) => void }) => Promise<JobOutcome>;
registerKind(kind: JobKind, runner: JobRunner): void;                 // composition root
enqueue(input: { kind; projectId?; adapterIds: string[]; payload; actor; parentRequestId; idempotencyKey? }, event): Promise<Job>;
get(actor, id): Promise<Job>;                                          // includes queue_position
list(actor, filter: { projectId?; kind?; status? }, page): Promise<Page<Job>>;
wait(id, seconds): Promise<Job>;
cancel(actor, id, event): Promise<void>;
events(id): ReadableStream<SseEvent>;
recover(event): Promise<RecoveryReport>;
heartbeat(): { alive: boolean; running: number; queued: number; lastTickAt: string };
```

Job shape on the API:

```json
{ "id": "01J...", "kind": "checkout", "status": "running", "queue_position": null,
  "project_id": "01J...", "adapter_ids": ["01J..."],
  "progress": { "phase": "restore", "adapters": { "01J...": { "table": "orders", "rows": 120433, "tables_done": 12, "tables_total": 42 } } },
  "result": null, "error": null,
  "actor": { "kind": "token", "label": "token:ci-shop" },
  "created_at": "...", "started_at": "...", "finished_at": null }
```

SSE stream `GET /api/v1/jobs/{id}/events`: events `progress` (the `progress` object), `status` (new status, with `result` or `error` when terminal), `heartbeat` every 15 s; the stream closes after a terminal `status`. Reconnect with `Last-Event-ID` replays the last status.

## 16.3 Dispatcher loop

```text
every 500 ms, or immediately after enqueue:
  running = tasks in flight
  while running < cap:
    job = next queued job whose adapters are not claimed by a running job   (claims checked again here)
    if none: break
    mark running (started_at), claim adapters, start task:
      runner({ job, event, signal, progress }) -> outcome
      on success: status from outcome (succeeded | partial), result, release claims and pins
      on error: status failed (or cancelled when the signal fired), error { kind, message, details }
      finally: emit status over SSE, resolve waiters, write the job's wide event
```

Claims live in memory and are rebuilt from the `jobs` table at boot. Because there is one process, the in-memory claim set is the truth during runtime; the table is the truth across restarts.

## 16.4 Cancel semantics

| Job kind | Between batches | In-flight statement |
| --- | --- | --- |
| snapshot | stop reading, release pins, state failed | engine cancel of the running `FETCH` or query |
| checkout | stop before the next batch; transaction rolled back on the SQL engines; MongoDB leaves the collection partially restored (result `unknown`) | engine cancel |
| import | stop before the next batch; transaction rolled back where it exists | engine cancel |
| diff | stop merging; diff failed | engine cancel of the live read |
| state_delete, storage_migration, backup, archive_import | stop at the next item; already-deleted or copied items stay | none |
| project_delete, adapter_delete | stop between adapters; nothing removed unless every restore succeeded | engine cancel |

## 16.5 Boot recovery

```text
for each job with status running:
  status = interrupted; finished_at = now; error = { kind: "interrupted" }
  release blob_pins for the job; delete uploads/<job>; clear claims
  if kind in (checkout, import, project_delete, adapter_delete) or progress.phase = counters:
    project.head_status = unknown; banner text recorded in the project
  if kind = snapshot or diff or archive_import: state.status = failed for the job's state
  if kind = storage_migration: settings unchanged (source still active)
write one boot wide event with the counts
```

## 16.6 Performance targets

| Path | Target | Source |
| --- | --- | --- |
| Enqueue to running | under 1 s with a free slot | 08 §8.2 |
| SSE latency | under 500 ms from progress write to client | Batching rule |
| Progress write rate | at most 4 per second per job | 08 §8.2 |
| Recovery | under 5 s for 1 000 stale jobs | Estimate |

## 16.7 Security constraints

`get`, `list`, and `events` filter by project scope; `cancel` is the actor's own jobs for `qa` and any job for `admin`. Progress and results carry ids, counts, and codes only. The SSE endpoint accepts cookie sessions and bearer tokens.

## 16.8 Component and contract

`modules/jobs/{jobs.dispatcher.ts, jobs.events.ts, jobs.recovery.ts, jobs.service.ts, jobs.repository.ts}`. Locked: the job shape in §16.2, the SSE event names, the `JobKind` and `JobStatus` enums (`@testate/shared`), and the exclusivity rule.

## 16.9 What this does not do

- No retries on failure; a failed job is inspected and re-run by a person or CI.
- No priorities; first come, first served under the cap.
- No scheduling; retention sweeps are an internal timer, not jobs.
- No cross-process queue; one process only.

## 16.10 Cross-references

| Concern | Source |
| --- | --- |
| Job kinds and their runners | 05 §5.4 to §5.16 |
| Recovery effect on HEAD | 06 §6.9, [13-checkout-and-restore.md](13-checkout-and-restore.md) |
| Pins | [15-snapshot-store.md](15-snapshot-store.md) §15.1 |
| Wide event per job | [21-wide-event-logging.md](21-wide-event-logging.md) |

## 16.11 Open follow-ups

| Item | Revisit when |
| --- | --- |
| Priority for CI checkouts over dashboard snapshots | Queue waits are reported in practice |
| Per-project concurrency | Two projects starve each other on one instance |
