# 10. Diffs

Module: `diffs` ([../technical-specs/05-module-definitions.md §5.10](../technical-specs/05-module-definitions.md)). Engine: [20](../technical-specs/20-diff-engine.md). Paths under `/projects/{slug}`.

## 10.1 `POST .../diffs`

**Purpose.** Compare two states, or a state and live (stories 88, 89).

**Access.** `qa`.

**Input.** Body: `base_state_id` required; `target` required: `{ "state_id" }` or `"live"`; `adapter_ids` optional.

**Behavior.** Enqueue job `diff`; a live target first takes a hidden `diff` state for the adapters (claims them, `JOB_IN_PROGRESS`, counts against quota); merge per table per [20 §20.3](../technical-specs/20-diff-engine.md); results stored as blobs; `expires_at` from `retention.diff_days`. Audit `diff.created`. A comparison that finds no row and no schema change is discarded when its job ends, hidden live snapshot included; the job's terminal result is `{ "diff_id", "adapters": <compared count>, "moved": false }`, and the diff then answers `NOT_FOUND`. A live diff of the project's HEAD state also settles the head: `moved: true` marks the head dirty, `moved: false` marks it clean.

**Output.** `202 { "data": { "diff": { "id", "status": "running", ... }, "job": {...} } }`. **Errors.** `NOT_FOUND`, `CONFLICT` (state not `ready`; no shared adapter), `QUOTA_EXCEEDED`, `JOB_IN_PROGRESS`, `VALIDATION_ERROR`. **Traceability.** Stories 88, 89.

## 10.2 `GET .../diffs` and `GET .../diffs/{id}`

**Purpose.** List and summary. **Access.** `viewer`. **Input.** Query (list only): `limit` (default 50, max 500); the list is not cursor-paged, `page.next_cursor` is always null.

**Output.** `200`

```json
{ "data": { "id": "01J...", "status": "ready", "base": { "id": "01J...", "name": "seeded-baseline" }, "target": { "live": true, "snapshot_state_id": "01J..." }, "expires_at": "...", "created_at": "...",
  "adapters": [ { "adapter_id": "01J...", "name": "orders-db", "engine": "postgres", "compared": true,
    "tables": [ { "schema": "public", "name": "orders", "compare": "primary-key", "added": 12, "removed": 0, "changed": 3, "unchanged": false, "schema_changed": null } ] } ] } }
```

`adapters[].engine` is the engine at the base state, so a document store's changes read as documents.

**Errors.** `NOT_FOUND`. **Traceability.** Story 88.

## 10.3 `GET .../diffs/{id}/rows`

**Purpose.** Drill-down (story 90). **Access.** `viewer`. **Input.** Query: `adapter_id` required, `table` required, `op` optional (`added` | `removed` | `changed`), `cursor`, `limit` (default 100, max 500). **Output.** `200 { "data": [ { "k": ["88213"], "op": "changed", "before": {...}, "after": {...}, "changed_columns": ["status"] } ], "page": {...}, "masked_columns": [] }`. Masks by role. **Errors.** `NOT_FOUND`, `CONFLICT` (diff not ready), `VALIDATION_ERROR` (`cursor` is not a valid page offset). **Traceability.** Stories 90, 92.

## 10.4 `GET .../diffs/{id}/export`

**Purpose.** Whole diff or one table as a file (story 91). **Access.** `viewer`. **Input.** Query: `format` `csv` | `jsonl` required; `adapter_id`, `table` optional. **Output.** `200` stream, attachment. **Errors.** `NOT_FOUND`, `CONFLICT` (diff not ready). **Traceability.** Story 91.

## 10.5 `DELETE .../diffs/{id}`

**Purpose.** Remove the diff, its blobs, and its hidden state. **Access.** `qa`. **Output.** `204`. **Errors.** `NOT_FOUND`, `CONFLICT` (running). **Traceability.** Story 120.
