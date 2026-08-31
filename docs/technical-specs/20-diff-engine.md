# 20. Diff Engine

A diff compares two states, or a state and the live database, table by table and row by row, and stores a queryable result. This document is the single source for the merge, the PK-less fallback, the live target, storage of results, the row drill-down, export, and retention. Cite it.

## 20.1 Decision matrix

| Concern | Decision | Rationale |
| --- | --- | --- |
| Inputs | Two manifests for the same adapter set (the intersection of adapters; others reported `not_compared`) | Story 85 |
| Live target | `diffs.create` first takes a hidden state of kind `diff` for the involved adapters (consistent read), then diffs the two manifests; the hidden state is owned by the diff, counted in quota, deleted with it, and never listed | Story 86; 05 §5.10 |
| Same blob | Tables whose `blob_hash` is equal on both sides are reported unchanged without reading | Dedup makes this free |
| Merge | Both blobs are sorted by the same key: a streaming merge yields `added`, `removed`, `changed` (same key, different `RowText`) | 15 §15.1 determinism |
| PK-less tables | Sorted by row hash on both sides: merge yields `added` and `removed` only; `changed` is not defined | Story 89 |
| Schema change between states | Columns present on one side only make every row `changed`; the summary flags `schema_changed` per table with the column list so the count is explained | Honest counts |
| Result storage | Per table: `diff_tables` row with counts and a blob of diff rows `{"k":..., "op":"added"|"removed"|"changed", "before":{...}, "after":{...}}`, sorted by key, gzip, content-addressed and refcounted like snapshot blobs | Story 87; reuse the store |
| Drill-down | `rows(diffId, adapterId, table, cursor)` pages the diff blob by key with optional `op` filter | Story 87 |
| Export | CSV (one row per diff row with `op`, key columns, then `before.<col>`, `after.<col>`) or JSON lines | Story 88 |
| Retention | `expires_at = created_at + retention.diff_days`; the daily sweep deletes the diff, its blobs (refcount), and its hidden state | Story 116 |
| Concurrency | A live diff claims the involved adapters like a snapshot; `JOB_IN_PROGRESS` applies | 16 §16.1 |

## 20.2 Interface

```ts
create(actor, slug, { baseStateId; targetStateId | "live"; adapterIds? }, event): Promise<Job>;   // kind diff
get(actor, slug, id): Promise<{
  base: StateRef; target: StateRef | { live: true; snapshotStateId };
  adapters: Array<{ adapterId; name; compared: boolean; tables: Array<{ schema; name; compare: "primary-key" | "row-hash"; added; removed; changed; unchanged: boolean; schema_changed?: string[] }> }>;
  expires_at;
}>;
rows(actor, slug, id, adapterId, table, { cursor?; limit?; op?: "added" | "removed" | "changed" }): Promise<Page<DiffRow>>;
export(actor, slug, id, { format: "csv" | "jsonl"; adapterId?; table? }): ReadableStream;
remove(actor, slug, id, event): Promise<void>;
```

Diff row:

```json
{ "k": ["01J..."], "op": "changed",
  "before": { "id": "01J...", "status": "pending", "total": "120.00" },
  "after":  { "id": "01J...", "status": "paid",    "total": "120.00" },
  "changed_columns": ["status"] }
```

## 20.3 Merge algorithm

```text
open A = decodeChunks(blob A), B = decodeChunks(blob B)   (both sorted by k)
a = next(A), b = next(B)
while a or b:
  if a and (!b or a.k < b.k):  emit removed(a); a = next(A)
  else if b and (!a or b.k < a.k): emit added(b); b = next(B)
  else:
    if a.r !== b.r: emit changed(a, b, changedColumns(a.r, b.r))
    a = next(A); b = next(B)
```

Keys compare as tuples: numbers numerically, strings by code point, UUID strings by code point (UUID v7 keys sort by time), row hashes as strings. `changedColumns` parses both `RowText`s once and compares values by JSON equality.

## 20.4 Performance targets

| Path | Target | Source |
| --- | --- | --- |
| Unchanged table | zero reads (hash equality) | Design |
| Merge | disk-bound; 200 000 rows/s on local blobs | Estimate |
| Memory | one chunk per side per table | 08 §8.4 |
| Drill-down page | under 300 ms after the first page (index of chunk offsets kept per diff blob) | 08 §8.2 |

## 20.5 Security constraints

`qa` creates; `viewer` reads and exports within scope. Diff rows contain data; masks (24 §24.4) apply to `viewer` and agent readers on masked columns, both before and after. Diff blobs live in the snapshot store with the same protections.

## 20.6 Component and contract

`lib/snapshot/merge.ts` (pure, tested with two in-memory streams), `modules/diffs/{diffs.job.ts, diffs.service.ts, diffs.repository.ts, diffs.export.ts}`. Locked: the diff row shape, the summary shape, the `compare` enum.

## 20.7 What this does not do

- No three-way diff, no merge, no apply. A diff is a report.
- No diff across adapters of different engines.
- No live-versus-live diff; one side is always a state.
- No column-level ignore lists in this release.

## 20.8 Cross-references

| Concern | Source |
| --- | --- |
| Blob determinism and layout | [15-snapshot-store.md](15-snapshot-store.md) |
| Hidden diff states | 05 §5.10, 06 §6.5 |
| Masks | [24-table-editing.md](24-table-editing.md) §24.4 |
| Retention | 05 §5.14 |

## 20.9 Open follow-ups

| Item | Revisit when |
| --- | --- |
| Ignore columns (`updated_at`) per diff | Users complain about noise |
| Apply a diff as an import | Users ask to replay a test's data changes elsewhere |
