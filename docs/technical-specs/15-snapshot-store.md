# 15. Snapshot Store

The snapshot store holds the bytes behind every state: one gzip file per table per snapshot, content-addressed, shared between states that captured the same bytes. This document is the single source for the blob layout, manifests, reference counting, pins, garbage collection, archives, the S3 driver, store migration, and quota accounting. Cite it; do not restate it.

## 15.1 Decision matrix

| Concern | Decision | Rationale |
| --- | --- | --- |
| Unit | One blob per table per adapter per state: gzip of the sorted JSON-line stream | Story 67: an unchanged table costs nothing between two states |
| Address | SHA-256 hex of the gzip bytes; layout `blobs/<first two hex>/<hash>` | Deterministic; two-level fan-out keeps directories small |
| Determinism | Session time zone pinned to UTC, rows sorted by primary key or row hash, gzip with a fixed header (mtime 0, no name), fixed compression level 6 | Byte-identical output for identical data, so dedup works |
| References | `blobs.ref_count` counts manifests (`state_adapters.tables[].blob_hash`) and diff tables that reference the blob | GC is a counter check, not a scan |
| Pins | `blob_pins(blob_hash, job_id)`: every blob a running snapshot, archive import, diff, or backup touches is pinned until the job's manifest rows commit or the job ends | Two concurrent snapshots can dedupe onto one blob while a delete runs; pins are a set, never a single column |
| GC | Runs inside the `state_delete` and `diff` delete jobs: decrement refs, delete blobs with `ref_count = 0` and no pin; a daily sweep re-checks orphans | Story 66 |
| Write | Local: write `<hash>.tmp`, fsync, rename; S3: `put` then verify size | No partial blob is ever addressable |
| Manifest | `state_adapters.tables` JSON: `{ schema, name, rows, bytes, blob_hash, sort, warnings }` plus `introspection` and `fingerprint` | The checkout plan and the diff need nothing but the manifest |
| Archive | PAX-format tar written as a stream: `manifest.json`, `adapters/<id>.json`, `blobs/<hash>` | Story 68; PAX for entries over 8 GiB and long names; no temp file |
| Drivers | `local` and `s3` behind `BlobStore`; `memory` for tests | Two production adapters justify the seam |
| Migration | Job copies every referenced blob to the target, verifies hashes, flips `store.driver`, then deletes the source on admin confirmation | Story 115 |
| Quota | Per project: sum of unique blob bytes referenced by the project's states; instance ceiling: sum over all projects; warn at 80 percent, refuse new states at 100 percent | Story 14 |
| Hidden diff snapshots | Kind `diff` states count against quota while the diff lives and are deleted with it | 05 §5.10 |

## 15.2 Interface

```ts
// lib/blobstore/index.ts
interface BlobStore {
  put(stream: ReadableStream<Uint8Array>, opts: { expectedHash?: string; pin: JobId }): Promise<{ hash: string; size: number; existed: boolean }>;
  get(hash: string): ReadableStream<Uint8Array>;
  has(hash: string): Promise<boolean>;
  stat(hash: string): Promise<{ size: number } | null>;
  delete(hash: string): Promise<void>;          // only called by GC after the ref and pin checks
  list(cursor?: string): AsyncIterable<{ hash: string; size: number }>;   // migration and orphan sweep
}
// lib/snapshot/
encodeChunks(rows: AsyncIterable<EncodedRow>): ReadableStream<Uint8Array>;   // JSON lines, gzip, deterministic
decodeChunks(stream: ReadableStream<Uint8Array>): AsyncIterable<EncodedRow>;
writeArchive(manifest, blobs: (hash) => ReadableStream): ReadableStream<Uint8Array>;   // PAX tar
readArchive(stream): AsyncIterable<{ kind: "manifest" | "adapter" | "blob"; name; hash?; body: ReadableStream }>;
```

Line format inside a blob: one JSON object per row, exactly the `RowText` the engine produced, preceded by the sort key: `{"k":["01J..."],"r":{...}}`. Row-hash tables use `{"k":"<sha256>","r":{...}}`.

## 15.3 Snapshot write path

```text
for each adapter (parallel under the cap):
  run = engine.snapshot(conn, opts)
  for each table chunk stream:
    stream -> encodeChunks -> hasher + counter -> blobstore.put(pin: job)
    manifest.tables.push({ ..., blob_hash, rows, bytes })
  await run.manifest -> fingerprint, introspection, warnings
insert state_adapters rows and increment blobs.ref_count in one metadata transaction
release pins; state.status = ready; state.size_bytes = sum of unique blob bytes
```

A failure at any point releases pins; blobs written by the failed job stay until the daily orphan sweep unless referenced elsewhere.

## 15.4 Delete and GC path

```text
state_delete job:
  refuse when protected or kind init
  metadata transaction: delete state_adapters (cascade), decrement ref_count per referenced hash
  for each hash with ref_count = 0 and no blob_pins row: blobstore.delete
  update project quota usage
daily sweep:
  for each blob in store not in blobs table or with ref_count = 0 and no pin older than 24 h: delete
```

## 15.5 Archive format

```text
testate-state-<slug>-<name>.tar
  manifest.json          { version: 1, state: { name, notes, tags, kind, created_at }, adapters: [ids], key: none }
  adapters/<id>.json     state_adapters row: adapter_name, engine, engine_version, fingerprint, consistency, tables, introspection, warnings
  blobs/<hash>           gzip bytes, PAX headers for size and path
```

Upload: stream through `readArchive`, `put` every blob with `expectedHash` (mismatch fails the job before any state row exists), then ask for the adapter mapping (archive adapter → existing adapter of the same engine, or create new), then create the state with kind `manual` and no parent.

## 15.6 S3 driver

`Bun.S3Client` with `bucket`, `endpoint`, `region`, `virtualHostedStyle`, sealed keys from settings or environment. Layout identical to local under `<prefix>/blobs/`. `put` streams with a known length when available, else multipart; verify by `HEAD` size. `list` uses `S3Client.list` with continuation tokens. Retries: three attempts with exponential backoff on 5xx and throttling. The local disk keeps no cache; checkouts stream blobs from S3 directly.

## 15.7 Store migration job

Refused while any job runs. Steps: copy every blob with `ref_count > 0` from source to target with hash verification; write a marker; flip `store.driver` and config in settings inside one transaction; new jobs use the target; the source is left in place until an admin confirms deletion from the settings page. Interruption before the flip leaves the source active and the job `interrupted`; re-running skips blobs already present.

## 15.8 Quota accounting

`states.size_bytes` is the sum of unique blob sizes referenced by that state. Project usage is the sum of unique blob sizes over all its states (computed by a query over `state_adapters` JSON tables materialized into a `state_blobs(state_id, blob_hash)` index table maintained with the manifest). Instance usage is the sum over all projects. Checks run at job start and again before the first blob write.

## 15.9 Performance targets

| Path | Target | Source |
| --- | --- | --- |
| Blob write | disk or S3 bound; gzip level 6 at 50 MB/s input on two cores | Estimate |
| Dedup check | `has(hash)` under 5 ms local, one `HEAD` on S3 | Design |
| GC of a state | proportional to its blob count; under 1 s for 500 tables local | Design |
| Archive download | starts within 1 s; streams at disk speed | Story 68 |

## 15.10 Security constraints

Blobs contain data, never credentials or query text. The local store is inside `/data` with the container user's permissions. S3 keys are sealed. Archives contain no keys and no secrets. Downloads require the `viewer` role and project scope; uploads require `qa`.

## 15.11 Component and contract

`lib/blobstore/{index.ts, local.ts, s3.ts, memory.ts}`, `lib/snapshot/{codec.ts, manifest.ts, tar.ts, merge.ts}`. Locked: the `BlobStore` interface, the line format in §15.2, the archive layout in §15.5, and the `blobs` and `blob_pins` tables.

## 15.12 What this does not do

- No encryption of blobs at rest; the volume or bucket policy owns that.
- No cross-instance replication; archives move states by hand.
- No compression choice per adapter; gzip level 6 everywhere, so dedup holds.
- No partial-table blobs; a table is one blob.

## 15.13 Cross-references

| Concern | Source |
| --- | --- |
| Row format | ADR 0001, [12-engine-port.md](12-engine-port.md) §12.4 |
| Diff over blobs | [20-diff-engine.md](20-diff-engine.md) |
| Quota stories | `../PRD.md` §4.4, story 14 |
| Backup job | 05 §5.14, [22-base-path-and-boot.md](22-base-path-and-boot.md) |

## 15.14 Open follow-ups

| Item | Revisit when |
| --- | --- |
| zstd instead of gzip | Bun ships a streaming zstd API and snapshot CPU becomes the bottleneck |
| Chunked blobs for tables over 4 GiB | A single-table blob exceeds S3 single-put limits in practice |
