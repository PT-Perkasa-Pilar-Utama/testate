# 5. Module Definitions

## 5.1 Module structure

Every module under `apps/api/src/modules/<name>/` has the same six files, plus concern-split siblings when a file passes 250 lines.

```
apps/api/src/modules/<name>/
  <name>.router.ts        # Hono router: routes, auth and role middleware, OpenAPI descriptors
  <name>.handler.ts       # HTTP in and out: valibot parse, call service, envelope; no logic
  <name>.service.ts       # business rules; the module's public surface; no Hono context
  <name>.repository.ts    # every SQL statement for the module's tables
  <name>.schema.ts        # module-local valibot schemas; API shapes come from @testate/shared
  <name>.test.ts          # unit tests for the service (AAA); API tests live in apps/api/test/
  <name>.<concern>.ts     # split siblings: data.rows.ts, states.snapshot.job.ts, ...
```

Rules: handlers never touch a repository; services never see a Hono context; a module reaches another only through `*.service.ts` exports and `@testate/shared`; every service function takes the `WideEvent` and fills the `op` section; every destructive service function writes its audit row through `audit.service`.

Each definition below states the responsibility, the public surface as an interface (invariants, ordering, error modes, configuration), the owned tables, the stories served, the seams, and why the module is deep.

## 5.2 `auth`

**Responsibility.** Turn a credential into an actor: cookie sessions for the dashboard, bearer tokens for automation. Enforce lockout, forced password change, session expiry, and token scope.

**Public surface.**

```ts
login(input: { username; password }, meta: { ip; userAgent }, event): Promise<{ session: Session; mustChangePassword: boolean }>
logout(sessionId, event): Promise<void>
changeOwnPassword(userId, { current; next }, event): Promise<void>       // revokes every other session
authenticate(req): Promise<Actor | null>                                  // middleware; cookie or bearer
requireRole(minimum: Role): Middleware                                    // cumulative: admin ⊇ qa ⊇ viewer
requireProjectScope(): Middleware                                         // token scope check on /projects/:slug
createToken(actor, { name; role; projectIds | null; expiresAt? }, event): Promise<{ token: string; record: ApiToken }>   // token returned once
revokeToken(actor, tokenId, event): Promise<void>
```

| Invariants | Five failed logins per username lock the account for fifteen minutes; the counter resets on success. A session expires after twelve idle hours or seven days absolute. `mustChangePassword` blocks every route except `change password` and `logout`. A token's role is capped at the creator's role. A project-scoped token sees only its projects in every list. Passwords are argon2id hashes; sessions and tokens are SHA-256 hashes; none are ever returned. |
| Error modes | `UNAUTHORIZED` (bad credential, expired session, revoked token), `RATE_LIMITED` (locked account, token budget), `FORBIDDEN` (role or scope), `VALIDATION_ERROR`. |
| Configuration | Session TTLs, lockout threshold, token rate budget from `settings`; cookie name, path, and `Secure` from `lib/config` and the base path. |

**Owns.** `sessions`, `api_tokens`. **Stories.** 1, 2, 6 to 9, 107, 108. **Seams.** None external. **Deep because** every route reuses one `Actor` and one role lattice; scope, lockout, and expiry rules exist in one place.

## 5.3 `users`

**Responsibility.** Admin management of user accounts.

```ts
create(actor, { username; displayName; role; temporaryPassword }, event): Promise<User>   // mustChangePassword = true
update(actor, id, { displayName?; role? }, event): Promise<User>
disable(actor, id, event): Promise<void>                       // revokes sessions
remove(actor, id, event): Promise<void>                        // refuses the last admin
resetPassword(actor, id, { temporaryPassword }, event): Promise<void>   // mustChangePassword = true, revokes sessions
list(actor, page): Promise<Page<User>>
```

| Invariants | The last enabled admin cannot be disabled, demoted, or deleted. Temporary passwords obey the length rule and are never stored in plain text. Audit rows carry the target username as text. |
| Error modes | `CONFLICT` (username taken, last admin), `NOT_FOUND`, `VALIDATION_ERROR`. |

**Owns.** `users`. **Stories.** 3, 4, 5. **Deep because** the last-admin and forced-change rules are enforced once.

## 5.4 `projects`

**Responsibility.** Project lifecycle, HEAD, quota, overview, and deletion with return to init.

```ts
create(actor, { slug; name; description? }, event): Promise<Project>
update(actor, slug, patch, event): Promise<Project>
get(actor, slug): Promise<ProjectOverview>          // HEAD, head status, adapters, latest jobs, quota usage
list(actor, page): Promise<Page<Project>>           // scoped for tokens
setHead(slug, stateId | null, status: "at_state" | "unknown" | "none", event): Promise<void>   // called by checkouts, states, jobs recovery
quotaUsage(slug): Promise<{ usedBytes; quotaBytes; instanceUsedBytes; instanceCeilingBytes }>
deletionPlan(actor, slug): Promise<DeletionPlan>    // per database adapter: restore | force | skip(reason)
deleteProject(actor, slug, { confirmSlug; plan: PlanChoice[] }, event): Promise<Job>   // job kind project_delete
```

| Invariants | Slug is `[a-z0-9-]{2,64}`, unique. Deletion requires `confirmSlug === slug` and the admin role. The delete job runs the plan through `checkouts.returnToInit`; removal happens only after every planned restore succeeded; a failure leaves the project, sets HEAD unknown on failed adapters, and the job offers retry. Removal order: project-scoped tokens revoked, mappings, states (blob refcounts), adapters, project. Audit rows outlive the project. |
| Ordering | `deletionPlan` must be fetched before `deleteProject`; the plan is re-validated at job start (adapter mode, reachability) and the job fails on a mismatch. |
| Error modes | `CONFLICT` (slug taken, wrong confirm slug, plan stale), `JOB_IN_PROGRESS` (any job on the project), `FORBIDDEN`. |

**Owns.** `projects`. **Stories.** 10 to 16. **Deep because** HEAD semantics and the deletion recipe live here and nowhere else.

## 5.5 `adapters`

**Responsibility.** Connection records of both kinds, their sealed configs, probing, modes, and their lifecycle events (init state, target change, deletion).

```ts
testDraft(actor, draft: AdapterDraft, event): Promise<ProbeResult>                   // stateless; runs netguard + probe
create(actor, slug, draft, event): Promise<Adapter>                                    // seals config; database kind enqueues init state
update(actor, slug, id, patch, event): Promise<Adapter>                                // target change enqueues init state; loosening needs admin
retest(actor, slug, id, event): Promise<ProbeResult>                                   // refreshes capabilities, status, engine_version
setMode(actor, slug, id, mode, event): Promise<Adapter>                                // read_only -> sandbox requires admin
list(actor, slug): Promise<Adapter[]>                                                  // never returns sealed fields; returns "set", set_at, key fingerprint
resolveDatabase(id): Promise<{ ref: ConnectionRef; readOnlyRef: ConnectionRef | null; excluded: TableRef[]; schemas: string[]; mode; lockTimeoutMs; restoreMode }>   // for modules; decrypts in memory
resolveFiles(id): Promise<FileSource>                                                  // storage kind
deletionPlan(actor, slug, id): Promise<DeletionPlan>
remove(actor, slug, id, { plan }, event): Promise<Job>                                 // job kind adapter_delete
recheckDenyList(event): Promise<{ disabled: AdapterId[] }>                             // called by settings on list change
```

| Invariants | Every create, update, retest, and resolve runs `lib/netguard` on the resolved address. Probe refuses engines below the floor (`ENGINE_UNSUPPORTED`). `capabilities`, `engine_version`, `dialect`, and the selected strategy are stored on probe. A change of host, port, or database (`target_hash`) enqueues a new init state. Rename changes nothing else. `sandbox` to `read_only` is `qa`; `read_only` to `sandbox` is `admin` with its own audit action `adapter.mode_loosened`. Sealed fields accept a new value or the sentinel `keep`. Deleting keeps state data; manifests mark the adapter removed. |
| Error modes | `HOST_BLOCKED`, `ADAPTER_UNREACHABLE`, `ENGINE_UNSUPPORTED`, `FORBIDDEN` (loosening), `JOB_IN_PROGRESS`, `CONFLICT` (name taken in project). |
| Configuration | Default excluded tables list (`lib/engines/pure/excluded-tables.ts`), default lock timeout 60 s, restore mode `atomic`. |

**Owns.** `adapters`, `known_host_keys`. **Stories.** 15 to 31, 90, 95. **Seams.** `lib/engines` (probe), `lib/files` (storage test), `lib/netguard`, `lib/sealed`. **Deep because** every other module gets a resolved, checked, decrypted reference from one call and never sees a credential.

## 5.6 `data`

**Responsibility.** Browse and query a database adapter: tables, grid, inline edit, SQL and MongoDB queries, limits, read-only enforcement, running queries, saved queries, history, write sessions.

```ts
tables(actor, adapterId): Promise<TableSummary[]>                                       // name, kind, row estimate, pk, unsupported
rows(actor, adapterId, query: PageQuery, event): Promise<Page<DisplayRow>>
edit(actor, adapterId, edit: RowEdit, event): Promise<DisplayRow | null>                // write session required
runQuery(actor, adapterId, q: EngineQuery, opts, event): Promise<QueryResult>          // read mode default; write mode needs session
runningQueries(actor, adapterId): Promise<RunningQuery[]>
cancelQuery(actor, adapterId, queryId, event): Promise<void>
startWriteSession(actor, adapterId, event): Promise<WriteSession>                      // qa + sandbox; stash on first write
endWriteSession(actor, sessionId, event): Promise<void>
savedQueries: { list; create; update; remove }
history(actor, adapterId, page): Promise<Page<QueryHistoryRow>>
exportResult(actor, adapterId, q, format: "csv" | "json", event): ReadableStream
exportTable(actor, adapterId, table, query: Partial<PageQuery>): AsyncGenerator<ExportPage>   // GET .../tables/{table}/export
```

| Invariants | Read mode opens a read-only transaction on the SQL engines; on MongoDB it uses the read-only credential when present, else the operation filter, and the response says which. Row cap default 500, max 5000; byte and time budgets from settings; the engine clamps. Inline edit requires a primary key. The first write in a session (query in write mode, edit, MongoDB write form) takes a stash through `states.stash(project, "write-session")`; the session ends on explicit end or after thirty minutes idle. Query history stores the text; the wide event stores only the hash and byte count. `exportTable` streams a whole table one keyset page at a time with the same filters, sort, and masks as `rows`; unlike `exportResult`, it has no row cap, because it exists to replace the old query export's silent truncation at 500 rows. |
| Error modes | `ADAPTER_READ_ONLY`, `FORBIDDEN` (no session, viewer), `VALIDATION_ERROR`, `ADAPTER_UNREACHABLE`, `CONFLICT` (no primary key), `RATE_LIMITED`. |

Tabular editing additions (`lookup`, `insertRows`, `updateRow`, `deleteRow`, `setWriteSessionOptions`, `policies`, `extractFixture`) and the mask rules are specified in [24-table-editing.md](24-table-editing.md); MongoDB adapters expose browse, read query, and `extractFixture` only.

**Owns.** `saved_queries`, `query_history`, `write_sessions`, `column_policies`. **Stories.** 32 to 45, 140 to 150. **Seams.** `lib/engines` (`pageRows`, `runQuery`, `editRow`, `writeRows`, `listRunningQueries`, `cancelQuery`). **Deep because** every guard (mode, role, session, stash, limits, policies, masks) sits in front of one engine call.

## 5.7 `imports`

**Responsibility.** Turn a CSV or XLSX file into rows in one table through a saved mapping, with dry run, modes, stash, report, and retry.

```ts
preview(actor, source: UploadRef | StorageFileRef, opts, event): Promise<Preview>       // columns, first 20 rows, sheets
mappings: { list; create; update; remove }                                              // per adapter and table
run(actor, slug, { adapterId; mappingId; source; mode; dryRun; stashFirst? }, event): Promise<Job>   // job kind import
report(actor, runId): Promise<ImportReport>
rejectedRows(actor, runId): ReadableStream                                               // CSV with reason column
listRuns(actor, slug, page): Promise<Page<ImportRun>>
sample(actor, adapterId, table, { format: "csv" | "xlsx"; mappingId? }): ReadableStream   // header, example row, schema block
```

Tabular adapters only; a Document adapter answers `ENGINE_UNSUPPORTED` on every import route.

| Invariants | Dry run validates types, nullability, key presence, and JSON cells for every row and returns the first hundred errors; it states that constraints and triggers are checked by the real run only. `replace` stashes first by default; `append` and `upsert` stash when `stashFirst` is true. Rows go through `lib/engines.writeRows` in batches inside a transaction where the engine allows. The rejected-rows file lives under `${TESTATE_DATA_DIR}/imports/<run>/rejected.csv` with the same columns plus `reason`, so it re-imports with the same mapping. Upload files are deleted when the job ends. |
| Error modes | `PAYLOAD_TOO_LARGE`, `VALIDATION_ERROR` (mapping mismatch, upsert without keys), `ADAPTER_READ_ONLY`, `JOB_IN_PROGRESS`. |

**Owns.** `import_mappings`, `import_runs`. **Stories.** 46 to 57. **Seams.** `lib/engines`, `lib/files` (storage source). **Deep because** parsing, transforms, validation, batching, and the report are one pipeline behind `run`.

## 5.8 `states`

**Responsibility.** Snapshots as states: taking them, listing them as a tree, protecting, renaming, deleting, archiving, and the stash mechanism every destructive module calls.

```ts
snapshot(actor, slug, { name; notes?; tags?; adapterIds? }, event): Promise<Job>       // kind snapshot
stash(slug, reason: "checkout" | "import" | "write-session", event): Promise<StateId>   // internal; kind stash; synchronous job inside the caller's job
initState(adapterId, event): Promise<Job>                                                // single adapter; protected; named init or init-<adapter>
list(actor, slug, filter: { kind?; tag?; includeStash? }, page): Promise<Page<State>>
tree(actor, slug): Promise<StateTreeNode[]>
get(actor, slug, idOrName): Promise<StateDetail>                                         // manifests per adapter, warnings, sizes
update(actor, slug, id, { name?; notes?; tags?; protected? }, event): Promise<State>
remove(actor, slug, id, event): Promise<Job>                                             // kind state_delete; refuses protected and init
archive(actor, slug, id): ReadableStream                                                  // PAX tar, streamed
importArchive(actor, slug, upload, mapping: ArchiveAdapterMapping[], event): Promise<Job> // kind archive_import
readManifest(stateId, adapterId): Promise<AdapterManifest>                               // for checkouts and diffs
openChunks(manifest, table): AsyncIterable<EncodedRow>                                    // from lib/blobstore through lib/snapshot
pruneStashes(slug, keep: number, event): Promise<void>                                   // retention
```

| Invariants | Names are unique per project case-insensitively and may not match the UUID pattern. Kinds: `init`, `manual`, `stash`, `diff` (hidden, owned by a diff). Init states are protected forever; protection blocks `remove`, never `deleteProject`. The parent of a new state is the project HEAD at snapshot time; HEAD moves to the new state. One snapshot job covers the chosen adapters in parallel under the global cap, one point in time per adapter. Blobs referenced by a running snapshot are pinned in `blob_pins` until the manifest row commits. Stash keeps the last N per project (setting); protecting a stash turns it into `manual`. An archive contains the manifest and its blobs; upload verifies every hash before creating the state and requires an adapter mapping by engine. |
| Ordering | `stash` runs inside the caller's job, before any destructive step, and its state id is recorded on the checkout, import run, or write session. |
| Error modes | `CONFLICT` (name taken, name looks like an id, protected), `QUOTA_EXCEEDED`, `JOB_IN_PROGRESS`, `ADAPTER_UNREACHABLE`, `VALIDATION_ERROR` (archive hash mismatch, engine mismatch in mapping). |

**Owns.** `states`, `state_adapters`, `blobs`, `blob_pins`. **Stories.** 58 to 71. **Seams.** `lib/engines` (`snapshot`), `lib/blobstore`, `lib/snapshot`. **Deep because** the consistent read, deduplication, pinning, naming, and tree rules are invisible to the six modules that call `stash` and `readManifest`.

## 5.9 `checkouts`

**Responsibility.** Restore a state: pre-flight, stash, drift, strategy, per-adapter execution, counters, HEAD, retry, and return-to-init for deletions.

```ts
preflight(actor, slug, stateRef, { force }): Promise<CheckoutPreflight>     // per adapter: drift diff, strategy, atomicity and locking notice, skipped (removed) adapters
create(actor, slug, { stateId | stateName; force?; adapterIds? }, event): Promise<{ checkout: Checkout; job: Job }>   // kind checkout
retryFailed(actor, slug, checkoutId, event): Promise<{ checkout: Checkout; job: Job }>
list(actor, slug, page): Promise<Page<Checkout>>
get(actor, slug, id): Promise<CheckoutDetail>                                 // per adapter result
returnToInit(slug, plan: PlanChoice[], event): Promise<AdapterResult[]>       // used by project and adapter delete jobs; no stash, no hooks
```

| Invariants | Order inside the job: stash → per adapter (parallel under the cap): introspect, `diffSchema`, refuse on drift unless force, `selectRestoreStrategy`, `lib/engines.checkout` → counters step → HEAD. Any adapter failure sets HEAD `unknown` and the checkout `partial`; retry re-runs failed adapters only with the same stash. A removed adapter in the state is reported `skipped`. The strategy and the atomicity and locking notice shown in `preflight` are the ones the job uses; the job re-probes privileges at start and degrades the strategy rather than failing mid-restore. |
| Error modes | `SCHEMA_DRIFT` (409, with tables and columns), `CHECKOUT_BLOCKED` (409, with blocking sessions and the terminate option when the probe allows), `ADAPTER_READ_ONLY`, `JOB_IN_PROGRESS`, `NOT_FOUND` (state), `CONFLICT` (both `stateId` and `stateName`). |

**Owns.** `checkouts`, `checkout_adapters`. **Stories.** 72 to 84. **Seams.** `lib/engines` (`checkout`, `repairCounters`, `introspect`), `lib/blobstore`. **Deep because** the whole restore recipe, including the deletion variant, is one function with one report shape.

## 5.10 `diffs`

**Responsibility.** Compare two states, or a state and live, table by table and row by row.

```ts
create(actor, slug, { baseStateId; targetStateId | "live" }, event): Promise<Job>       // kind diff
get(actor, slug, id): Promise<DiffSummary>                                              // per adapter, per table: added, removed, changed
rows(actor, slug, id, adapterId, table, page): Promise<Page<DiffRow>>                   // before and after per changed row
export(actor, slug, id, format: "csv" | "json"): ReadableStream
remove(actor, slug, id, event): Promise<void>
pruneExpired(event): Promise<void>                                                       // retention
```

| Invariants | A live target takes a hidden state of kind `diff` first; it counts against quota while the diff exists and is deleted with the diff. Tables with a primary key merge two sorted streams; tables without one compare row hashes and report added and removed only. Diff rows are stored as blobs referenced by `diff_tables`; the diff expires per the retention setting. |
| Error modes | `NOT_FOUND`, `CONFLICT` (states share no adapter), `QUOTA_EXCEEDED`, `JOB_IN_PROGRESS` (live target on a busy adapter). |

**Owns.** `diffs`, `diff_tables`. **Stories.** 85 to 89. **Seams.** `lib/snapshot.merge`, `lib/blobstore`, `lib/engines` (live read through `states.snapshot`). **Deep because** callers ask for a comparison and get a queryable result; the merge and the hidden snapshot are private.

## 5.11 `storage`

**Responsibility.** Read-only browsing of storage adapters.

```ts
list(actor, adapterId, path, page): Promise<Page<Entry>>       // name, kind, size, modified
stat(actor, adapterId, path): Promise<Entry>
preview(actor, adapterId, path): Promise<PreviewPayload>        // text, json, csv (first 200 rows), image, pdf up to the cap
download(actor, adapterId, path): ReadableStream
acceptHostKey(actor, adapterId, fingerprint, event): Promise<void>
```

| Invariants | No write and no delete exist on the port. Preview cap 5 MB. SFTP host key is trusted on first use and stored in `known_host_keys`; a changed key blocks every operation with `CONFLICT` until accepted. |

**Owns.** none (host keys belong to `adapters`). **Stories.** 91 to 94. **Seams.** `lib/files`. **Deep because** three protocols look like one directory tree.

## 5.12 `jobs`

**Responsibility.** The persisted queue and dispatcher for every long operation.

```ts
registerKind(kind: JobKind, runner: JobRunner): void                           // composition root only
enqueue(job: NewJob, event): Promise<Job>                                       // idempotency key aware
get(actor, id): Promise<Job>                                                    // queue_position when queued
list(actor, filter, page): Promise<Page<Job>>
wait(id, seconds: 1..300): Promise<Job>                                         // resolves on terminal status or timeout
cancel(actor, id, event): Promise<void>                                         // sets flag; runner cancels the engine statement
events(id): ReadableStream                                                      // SSE: progress, status
recover(event): Promise<void>                                                   // boot: running -> interrupted, HEAD unknown where needed
heartbeat(): { alive: boolean; runningCount: number }
```

| Invariants | One dispatcher runs jobs as concurrent tasks up to `TESTATE_JOB_CONCURRENCY` (default 2); each task's failure is isolated. A job on an adapter already busy is refused with `JOB_IN_PROGRESS` (409) at enqueue; a job beyond the global cap is queued with a `queue_position`. `Idempotency-Key` per token returns the existing job for twenty-four hours. Progress is written to `jobs.progress` in batches and pushed over SSE. On boot every `running` job becomes `interrupted`; checkout, import, counter-reset, and deletion-restore interruptions set HEAD `unknown`. |
| Error modes | `JOB_IN_PROGRESS`, `NOT_FOUND`, `CONFLICT` (cancel on a terminal job). |

**Owns.** `jobs`, `idempotency_keys`. **Stories.** 101 to 104. **Deep because** every module gets queueing, progress, wait, cancel, and recovery from `enqueue`.

## 5.13 `audit`

**Responsibility.** The durable record of who did what.

```ts
write(entry: AuditEntry, tx?): Promise<void>        // same transaction as metadata changes when tx is passed
list(actor, filter: { project?; actor?; action?; from?; to? }, page): Promise<Page<AuditRow>>
exportCsv(actor, filter): ReadableStream
prune(retentionDays, event): Promise<number>
```

| Invariants | Rows carry `project_slug`, `adapter_name`, and `actor_label` as text, so they survive deletion of their subject. Actions on target databases write a row when accepted and update it with the outcome. Viewers can read; nobody can edit. |

**Owns.** `audit_logs`. **Stories.** 105, 106. **Deep because** one `write` call gives every module the same shape and retention.

## 5.14 `settings`

**Responsibility.** Global configuration, the snapshot store switch and migration, backups, the deny list, and retention sweeps.

```ts
get(actor): Promise<Settings>
update(actor, patch, event): Promise<Settings>                          // deny list change calls adapters.recheckDenyList
migrateStore(actor, target: StoreConfig, event): Promise<Job>           // kind storage_migration; refused while jobs run
backup(actor, { includeBlobs }, event): Promise<Job>                    // kind backup; PAX tar to download or to the store
runRetention(event): Promise<RetentionReport>                           // daily: stashes, diffs, query history, job history, audit, import runs, logs
```

| Invariants | Environment values win over settings for the store (`TESTATE_STORE` set locks the field in the UI). The store switch is refused while any job runs and flips only after the migration job copied every referenced blob. Backups record the key fingerprints their sealed values need. |

**Owns.** `settings`. **Stories.** 114 to 117. **Deep because** retention for seven kinds of data is one daily sweep.

## 5.15 `ops`

**Responsibility.** Operational endpoints and the boot and shutdown sequence.

**Health monitor.** `GET /api/v1/health`, no authentication, returns liveness; with an admin session or token it returns the dependency breakdown.

```json
{ "data": { "status": "ok" } }

{ "data": {
  "status": "ok" | "degraded" | "down",
  "version": "1.2.0", "boot_id": "01J...", "uptime_s": 86400,
  "checks": {
    "metadata_db":   { "status": "ok", "latency_ms": 1 },
    "data_dir":      { "status": "ok", "free_bytes": 53687091200 },
    "snapshot_store":{ "status": "ok", "driver": "local" | "s3", "latency_ms": 12 },
    "dispatcher":    { "status": "ok", "running": 1, "queued": 0, "last_tick_at": "..." },
    "log_sink":      { "status": "ok" | "degraded" },
    "sealed_keys":   { "status": "ok", "active_fingerprint": "9f3c...", "extra_values": 0 }
  }
} }
```

`status` is `down` when the metadata database or the data directory fails, `degraded` when the store, the sink, or the dispatcher fails. `GET /api/v1/health/live` returns `204` for load balancers; `GET /api/v1/health/ready` returns `204` only after boot finished.

**Reset-state endpoint.** `POST /api/v1/admin/reset-state` with body `{ "seed": "dev" | "qa" }`, admin only. It is registered at route-registration time only when `TESTATE_ENV` is not `production`; in production the route does not exist and returns `404` like any unknown path. It refuses while jobs run, then: closes the dispatcher, deletes every metadata table, deletes the local snapshot store, uploads, import artifacts, and diff blobs, re-applies migrations, runs the chosen seed, restarts the dispatcher, and returns `200` with the seed name and counts. `dev` seeds the bootstrap admin, a `qa` user and a `viewer` user with known passwords, one project `demo` with database adapters pointing at the compose engines, a storage adapter at MinIO, and one manual state. `qa` seeds the bootstrap admin only. Seeds are idempotent functions in `modules/ops/ops.seeds.ts`, selected by the body field; `TESTATE_RESET_SEED` sets the default when the body omits it.

**Boot and shutdown.** See [22-base-path-and-boot.md](22-base-path-and-boot.md).

**Owns.** none. **Stories.** 118 to 122. **Deep because** health, reset, boot, and shutdown are the operator's whole contract in one module.

## 5.16 `tools`

**Responsibility.** Stateless helpers for QA: hash, random secret, UUID.

```ts
hash(actor, { algorithm: "argon2id" | "bcrypt" | "sha256" | "sha512" | "hmac_sha256"; value; secret?; salt?; cost? }): Promise<{ hash: string }>
random(actor, { bytes; encoding: "hex" | "base64" | "base64url" }): { value: string }
uuid(actor, { version: 4 | 7; count?: number }): { values: string[] }
```

| Invariants | Any role. No storage, no audit row, no wide-event field for inputs. Cost parameters capped (bcrypt 14, argon2id memory 128 MiB, count 100, bytes 1 024). Rate-limited per actor. |

**Owns.** none. **Stories.** 131 to 133. **Deep because** the same hashing code serves the tools menu, the form functions, and the import transform.

## 5.17 `agent`

**Responsibility.** The read-only MCP server for AI agents. Single source: [23-agent-access.md](23-agent-access.md).

```ts
createMcpServer(deps): McpServer          // read tools and resources only
requireAgentToken(): Middleware           // token kind agent; refused elsewhere
```

| Invariants | Only `kind = agent` tokens reach `/mcp`; agent tokens reach nothing else. Every tool runs through the read paths of `data`, `states`, `diffs`, `storage`, and `adapters` with masks on and lower caps. Every call writes `agent.tool_call`. |

**Owns.** none. **Stories.** 134 to 139. **Deep because** an agent learns a dozen tools and never a connection string.

## 5.18 Shared libraries

| Library | Port | Adapters | Cited spec |
| --- | --- | --- | --- |
| `lib/engines` | `DbEngine` (ADR 0001) | postgres, mysql, mongodb, fake | [12-engine-port.md](12-engine-port.md) |
| `lib/blobstore` | `BlobStore` (`put`, `get`, `has`, `delete`, `list`, `stat`) | local, s3, memory | [15-snapshot-store.md](15-snapshot-store.md) |
| `lib/files` | `FileSource` (`list`, `stat`, `read`) | s3, sftp, ftp, memory | [10-integration-points.md](10-integration-points.md) |
| `lib/snapshot` | pure: codec, manifest, merge, tar | none | 15, 20 |
| `lib/sealed` | pure: `seal`, `open`, `sweep`, registry | none | [17-sealed-values.md](17-sealed-values.md) |
| `lib/netguard` | pure + DNS: `check(host, port)` | none | [18-outbound-address-policy.md](18-outbound-address-policy.md) |
| `lib/logger` | `WideEvent`, sink | file, stdout | [21-wide-event-logging.md](21-wide-event-logging.md) |
| `lib/http` | envelope, errors, pagination, middleware | none | [07-security.md](07-security.md), `../api-specs/` |
| `lib/config` | env schema | none | [11-environment-configuration.md](11-environment-configuration.md) |
| `lib/db` | SQLite client, migration runner | none | [06-data-model.md](06-data-model.md) §6.9 |

`packages/shared` holds the request and response schemas for every resource, the enums (`Role`, `JobKind`, `JobStatus`, `EngineKind`, `AdapterKind`, `AdapterMode`, `StateKind`, `ErrorCode`), and nothing with I/O. Both apps import it; neither app re-declares a shape it defines.
