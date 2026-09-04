# 8. States

Module: `states` ([../technical-specs/05-module-definitions.md §5.8](../technical-specs/05-module-definitions.md)). Data: [06 §6.5](../technical-specs/06-data-model.md). Store: [15](../technical-specs/15-snapshot-store.md). All paths under `/projects/{slug}`.

State object:

```json
{ "id": "01J...", "name": "seeded-baseline", "kind": "manual", "status": "ready", "protected": true,
  "notes": "After db:seed:qa on 2026-08-28", "tags": ["baseline"],
  "parent_state_id": "01J...", "stash_reason": null,
  "adapters": [ { "adapter_id": "01J...", "adapter_name": "orders-db", "engine": "postgres", "engine_version": "16.3",
                  "fingerprint": "sha256:9f3c...", "consistency": "snapshot", "removed": false,
                  "row_count": 120433, "byte_count": 8123001, "warnings": [] } ],
  "size_bytes": 8123001, "actor": { "kind": "user", "label": "dina.qa" }, "job_id": "01J...",
  "created_at": "...", "updated_at": "..." }
```

Kinds: `init`, `manual`, `stash`; `diff` states are hidden and never listed (story 89, [20](../technical-specs/20-diff-engine.md)).

Every `{id}` below (8.4 to 8.7) accepts the state's id or its exact name, case-insensitively.

## 8.1 `GET .../states`

**Purpose.** List states. **Access.** `viewer`. **Input.** Query: `cursor`, `limit`, `sort` (`created_at`, `name`, `size_bytes`), `order`, `kind`, `tag`, `name` (exact, case-insensitive, for lookups by name), `include_stash` (default false), `protected`, `created_from`, `created_to`. **Output.** `200` list; each item is the state object plus `checkout_count` and `diff_count` (how many checkouts and diffs reference it). **Traceability.** Stories 64, 66.

## 8.2 `GET .../states/tree`

**Purpose.** The parent tree. **Access.** `viewer`. **Output.** `200 { "data": [ { "id", "name", "kind", "created_at", "size_bytes", "is_head": true, "children": [ ... ] } ] }` rooted at states with no parent; stashes included only with `?include_stash=true`. **Traceability.** Stories 65, 66.

## 8.3 `POST .../states`

**Purpose.** Take a state (snapshot).

**Access.** `qa`.

**Input.** Body: `name` required, 1 to 80 characters, unique per project case-insensitively, not matching the UUID pattern; `notes` optional; `tags` string[] optional; `adapter_ids` string[] optional, every database adapter of the project when omitted. Headers: `Idempotency-Key` optional; query `wait` optional.

**Behavior.**
1. Validate the name (`CONFLICT` on collision or UUID look-alike, story 64); quota check (`QUOTA_EXCEEDED`).
2. Resolve `adapter_ids`: an unknown adapter id answers `NOT_FOUND`; an explicit empty list answers `CONFLICT` ("pick at least one database to snapshot"); a project with no database adapter at all answers `CONFLICT` the same way when the field is omitted.
3. Create the state `creating` with `parent_state_id` = HEAD; enqueue job `snapshot` claiming the adapters (`JOB_IN_PROGRESS`).
4. The job reads each adapter at one instant (story 63), writes blobs with pins, commits manifests, sets `ready`, moves HEAD to the state; progress per table (story 74). Audit `state.created`.

**Output.** `202 { "data": { "state": {...creating}, "job": {...} } }`. **Errors.** `CONFLICT`, `NOT_FOUND` (unknown `adapter_ids` entry), `QUOTA_EXCEEDED`, `JOB_IN_PROGRESS`, `ADAPTER_UNREACHABLE`, `VALIDATION_ERROR`. **Traceability.** Stories 61, 62, 63, 64, 65, 70, 72, 73, 74, 114.

## 8.4 `GET .../states/{id}`

**Purpose.** Detail with per-adapter manifests (table list with rows, bytes, sort, warnings) and what changed against the parent state.

**Access.** `viewer`.

**Output.** `200`, the state object plus:

```json
{ "checkout_count": 3, "diff_count": 1,
  "last_checkout_at": "2026-08-29T09:10:00.000Z",
  "adapters": [ { "adapter_id": "01J...", "adapter_name": "orders-db", ...,
    "removed_tables": ["public.legacy_orders"],
    "tables": [ { "schema": "public", "name": "orders", "rows": 120433, "bytes": 812300,
      "blob_hash": "sha256:...", "sort": "primary-key", "warnings": [], "change": "changed" } ] } ] }
```

`last_checkout_at` is null when the state was never checked out. Per table, `change` is `"same"`, `"changed"`, or `"added"` against the parent's manifest for that table, or `null` when the state has no parent (a root state); a table the parent had and this state's adapter lacks is named in that adapter's `removed_tables` instead of appearing in `tables`.

**Errors.** `NOT_FOUND`. **Traceability.** Stories 66, 73.

## 8.5 `PATCH .../states/{id}`

**Purpose.** Rename, notes, tags, protect or unprotect. **Access.** `qa`. **Input.** Body: `name`?, `notes`?, `tags`?, `protected`?. **Behavior.** Init states cannot change `kind` or `protected` (`CONFLICT`); protecting a stash converts it to `manual`; names follow 8.3 rules; audit `state.protected` or `state.unprotected` when that field changes. **Output.** `200` state. **Errors.** `CONFLICT`, `NOT_FOUND`, `VALIDATION_ERROR`. **Traceability.** Stories 67, 68.

## 8.6 `DELETE .../states/{id}`

**Purpose.** Delete an unprotected state and reclaim storage. **Access.** `qa`. **Behavior.** Refuse protected and init states (`CONFLICT`); enqueue job `state_delete` (blob refcounts, GC per [15 §15.4](../technical-specs/15-snapshot-store.md)); deleting the state that is HEAD sets HEAD to `none`; diffs that reference the state are deleted with it. Audit `state.deleted`. **Output.** `202` job. **Errors.** `CONFLICT`, `NOT_FOUND`, `JOB_IN_PROGRESS`. **Traceability.** Story 69.

## 8.7 `GET .../states/{id}/archive`

**Purpose.** Download the state as a PAX tar (story 71). **Access.** `viewer`. **Output.** `200 application/x-tar`, `Content-Disposition: attachment; filename="testate-state-<slug>-<name>.tar"`, streamed. **Errors.** `NOT_FOUND`, `CONFLICT` (state not `ready`). **Traceability.** Story 71.

## 8.8 `GET .../uploads/{upload_id}/archive-manifest`

**Purpose.** Read an uploaded archive's adapters before normalizer them. **Access.** `qa`. **Output.** `200 { "data": { "state": { "name", "notes", "tags", "created_at" }, "adapters": [ { "archive_adapter_id", "adapter_name", "engine", "engine_version", "tables": 42, "row_count", "byte_count" } ] } }`. **Errors.** `NOT_FOUND`, `VALIDATION_ERROR` (not a Testate archive). **Traceability.** Story 71.

## 8.9 `POST .../states/import`

**Purpose.** Create a state from an uploaded archive with an adapter mapping.

**Access.** `qa`.

**Input.** Body: `upload_id` required (purpose `archive`); `name` required (8.3 rules); `adapter_mapping` required: `[ { "archive_adapter_id", "target": { "adapter_id" } | { "create": { "name", "config", "secrets", "mode" } } } ]` with engines matching.

**Behavior.** Enqueue job `archive_import`: verify every blob hash before any row exists (`VALIDATION_ERROR` on mismatch), create any new adapters (each with its own init state), create the state as `manual` with no parent, then `ready`. Audit `state.imported`.

**Output.** `202` job. **Errors.** `NOT_FOUND`, `VALIDATION_ERROR` (engine mismatch, hash mismatch), `CONFLICT` (name), `QUOTA_EXCEEDED`. **Traceability.** Story 71.
