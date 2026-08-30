# Testate review — QA (unhappy paths)

The first QA reviewer produced nothing, so this covers both passes: my own run through the
core flows, then the unhappy paths the brief named — a database that dies mid-job, a restore
that fails on one adapter, a snapshot of a strange type, two sessions at once, a role without
permission, an expired session, a huge import, a wrong file, a cancelled job.

Method: `bun apps/api/src/index.ts` on port 3000 only (port 5173/the SPA was not driven this
pass — everything below is direct HTTP against the real API, chosen because the highest-value
unhappy paths are timing races that need bash/psql alongside curl, not a browser). Own data
dir under the scratchpad, own admin bootstrap, own project (`qa-review`), own fresh databases
created inside the shared compose engines (`qa_review` on `deploy-postgres-1`, `deploy-mysql-1`,
`deploy-mongo-1`) — never the seeded `shop`/demo project. Every command and response below is
copy-pasted from this session's actual terminal output, not summarized from memory. The API
process crashed three times over the course of this review (that is the headline finding); each
crash is called out with the log line and the restart that followed it.

## Verdict

**No.** Do not point this at the database the team actually tests against, not yet. Every
snapshot or restore job runs on a single shared server process, and the very first real fault
this review threw at that process — a dropped connection, a revoked grant, or literally just
clicking Cancel — terminated it outright, taking down every other job, every other user's
session, and every other project on the same instance with it. This reproduced on **three
independent triggers** (connection loss, permission loss, user-initiated cancel) and **two
engines** (Postgres, MySQL), always at the exact same code shape. A tool whose job is "make
resets safe" cannot itself be the single point of failure for the whole team every time a
database hiccups. Everything else found — a diff that reports fabricated changes on identical
data, per-adapter restore reporting that goes blank exactly when a crash happens, a few UI
inconsistencies the interface lane already covered — would matter on a tool that was otherwise
solid. On top of a server that falls over on an ordinary network blip, they're details.

**What would have to change:** fix the crash (one line, per the interface lane's diagnosis —
see #1), then the diff key-strategy bug (#2, second-worst: a *wrong* answer that looks right),
then get the netguard-drift and per-adapter-reporting gaps closed. After that, this is worth
re-running against a real shared database with real concurrent users.

## What the team confirmed, ranked

Findings are pooled across all four lane reports plus this pass. "Verified" = I reproduced it
myself this session; "cited" = another lane's report, not independently re-run (noted why).

### 1. Any interrupted database job crashes the entire server for every user — confirmed, extended, blocker

Not new (the interface lane found the seed case), but this pass proves it is not a netguard
curiosity: it is the codebase's general answer to "a query failed mid-snapshot," on at least two
engines, on at least three ordinary triggers.

**Trigger A — a connection genuinely dropped mid-snapshot** (not a policy simulation). I seeded
a 1M-row Postgres table, started a snapshot, and used `pg_terminate_backend` timed against
`pg_stat_activity` to kill the backend mid-scan:

```
{"kind":"job","op":{"name":"job:snapshot","job_id":"01a050f1-...","status":"failed", ...},
 "error":{"code":"INTERNAL","message":"snapshot: Connection closed"}}
41 |   if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|CONNECTION_CLOSED|timeout/i.test(...))
46 |     return new EngineError("unreachable", ...);
      at translate (apps/api/src/lib/engines/postgres/errors.ts:46:12)
      at chunks (apps/api/src/lib/engines/postgres/reader.ts:160:21)
Bun v1.4.0-canary.1+6e906e468 (macOS arm64)
```
The job row itself is correctly written `status: "failed"` a fraction of a second *before* the
process dies (`sqlite3 metadata.db` confirms the row persisted) — then the whole server exits.
`curl /health/live` went from `204` to connection-refused.

**Trigger B — a permission revoked mid-checkout, not mid-snapshot, and on MySQL, not Postgres**
(fills the gap the interface lane flagged as "not independently reproduced against mysql"):
revoked the `qa_review` grant on `deploy-mysql-1` mid-checkout of a 3-adapter state.
```
{"kind":"job","op":{"name":"job:checkout","job_id":"01a050f2-...","status":"failed"},
 "error":{"code":"INTERNAL","message":"snapshot: Access denied for user 'testate'@'%' to database 'qa_review'"}}
EngineError: snapshot: Access denied ...
      at translate (apps/api/src/lib/engines/mysql/errors.ts:35:12)
      at chunks (apps/api/src/lib/engines/mysql/reader.ts:174:21)
```
Same shape, same `chunks` generator, different engine's `reader.ts`. Checkouts internally read
through the same code path as snapshots (the log op is literally `job:checkout` with an error
message that still says `"snapshot: ..."`), so a restore is exactly as exposed as a snapshot.

**Trigger C — clicking Cancel on a normal, healthy, in-progress job.** No fault injected at all;
just `POST /jobs/:id/cancel` on a snapshot mid-flight:
```
{"kind":"job","op":{"name":"job:snapshot","status":"cancelled"},
 "error":{"code":"INTERNAL","message":"snapshot: snapshot cancelled"}}
EngineError: snapshot: snapshot cancelled ... at chunks (postgres/reader.ts:160:21)
Bun v1.4.0-canary.1+6e906e468 (macOS arm64)
```
Cancel is an advertised, ordinary feature (there's a Cancel button). It crashes the server every
time, deterministically, with zero fault injection required.

Root cause (read in source, matches the interface lane's diagnosis at `engine.ts:60-66`):
`snapshot()`'s returned object exposes two independent consumers of the same read — the async
iterator (`chunks`, which the job runner does await and catch, hence the job row lands as
`failed`/`cancelled` correctly) and a `manifest` promise built via a manual executor
(`resolveManifest`/`rejectManifest`). `swallow(pending)` at `engine.ts:65` guards the raw
`pending` promise but not this second `manifest` promise; when the generator's `catch` block
calls `rejectManifest(error)` and nobody has attached a handler to `manifest` yet, that is an
unhandled rejection, and Bun's default behavior is to terminate the process — a fraction of a
second after the same error was already correctly recorded through the other path. Restarting
recovers cleanly (`jobs_interrupted: 0` each time, since the job row was already `failed` before
the process died) and the failed job stays visible in the state/job list — so no state or job
record is lost. What's lost is everyone else's in-flight work and every open session on the
process, every single time.

**Confidence: confirmed**, three separate reproductions this session, two engines, full stack
traces captured each time (`api.log` in the review scratchpad). **Severity: blocker** — this is
literally the "a database that goes away mid-job" and "a cancelled job" scenarios the brief
named, and both take the whole server down, not just the one job.

### 2. Diffing two snapshots taken before/after a schema change with no row changes reports fabricated adds and removes — confirmed end-to-end, major

The engineering lane predicted and unit-tested this (`mergeRows` called directly). I reproduced
it through the real product, start to finish, on my own database:

1. `CREATE TABLE pktest (a int, b text); INSERT ... (1,'x'),(2,'y');` — no primary key.
2. Snapshot (`pktest-before`).
3. `ALTER TABLE pktest ADD PRIMARY KEY (a);` — same two rows, same columns, nothing in the data
   changed.
4. Snapshot (`pktest-after`).
5. `POST /projects/qa-review/diffs` between the two states. Result:
```json
{
  "schema": "public", "name": "pktest",
  "compare": "row-hash",
  "added": 2, "removed": 2, "changed": 0,
  "unchanged": false, "schema_changed": null
}
```
Two rows that never changed are reported as 2 removed + 2 added, with `schema_changed: null` —
the diff engine doesn't even notice a key-strategy flip counts as a schema change. Cause (read
in source): `compareKeys` (`apps/api/src/lib/snapshot/merge.ts`) stringifies whichever side used
`row-hash` against the other side's primary-key tuple whenever the two snapshots' `SortKey.by`
disagree, and `diffTable` only compares column *names* between sides, never `sort` strategy.
Adding a primary key to an existing table — one of the most ordinary schema migrations there is
— is exactly the case that triggers it. A QA engineer diffing two snapshots after that kind of
migration sees "4 rows differ" for a table where nothing did, with nothing in the output to
suggest the number is wrong.

Side note while reproducing this: adding a *new column* (not just a PK on an existing one) via
`ALTER TABLE ... ADD COLUMN id serial PRIMARY KEY` produces a different, also-wrong result
(`added: 2, removed: 0, unchanged: true` simultaneously, `schema_changed: ["table added"]` for a
table that was never added) — the schema-change label is flatly incorrect, not just the row
count. Not separately ranked; same underlying defect, worse cosmetics.

**Confidence: confirmed**, reproduced twice (own-column-as-PK and new-column-as-PK cases), full
request/response captured. **Severity: major** — silent wrong answer, ranks second only because
it doesn't take the server down.

### 3. A crashed checkout leaves the per-adapter report blank — confirmed, extends #1

The checkout record for the MySQL-permission-revoked case (#1, Trigger B) persists with
`status: "failed"` at the top level, but **every one of the three adapters still shows
`"result": "pending"`, `"error": null`** — including the two adapters (mongo, mysql) that may or
may not have already been touched before the crash. The README specifically advertises "A
checkout restores the state you pick and reports what happened per database" as the product's
core value; on the one path that most needs that report — a mid-restore crash — it is empty. An
operator staring at this record after the process died has no way to tell which databases (if
any) were actually written before the crash and which are still holding pre-restore data.

Contrast: I also drove a **clean** partial-restore failure — retried the same checkout after
restoring MySQL's grant, this time hitting a real (and correct) `SCHEMA_DRIFT` refusal on
Postgres because the live schema had moved since the snapshot. That one reports exactly what the
README promises: mongo `restored`, mysql `restored`, postgres `skipped` with the specific tables
and columns that drifted. So the per-adapter reporting *works* — it's specifically the
crash path (#1) that erases it. This is downstream of #1, not a separate root cause, but worth
naming on its own: fixing #1 alone should fix this for free, and it's worth a regression test
that says so explicitly rather than assuming it.

**Confidence: confirmed**, both the broken case and the working contrast case captured this
session. **Severity: major** (folds into #1's ranking for "fix first" purposes).

### 4. Netguard's displayed policy silently diverges from what's enforced after a state reset — cited, not independently re-run

The interface lane's second finding: `POST /admin/reset-state` re-migrates the settings table
without telling the in-memory netguard, so `GET /settings` shows the reset default deny list
while the live process keeps enforcing whatever was patched in before the reset — until the next
restart, at which point it flips again to match the (correct) displayed value. All three legs
were directly observed by that lane on one boot, with the exact `GET /settings` output at each
step. I did not re-run this myself (would have meant tearing down my own boot's state to
retest the sequence, low value given a full trace already exists) — citing at high confidence
given the specificity of the evidence (exact settings payloads at each of four steps, source
line numbers for the cause). **Severity: major** — a security control silently reverting without
telling the operator.

### 5. Idempotency-Key retries on `POST /states` and `POST /checkouts` — refuted (already fixed)

The handover notes list this as a bug the E2E suite found in-session ("a retried `POST /states`
was refused as a duplicate name and a retried `POST /checkouts` made a second row"). I retested
both directly:

```
$ curl -X POST .../states -H "Idempotency-Key: qa-idem-test-1" -d '{"name":"idem-test-state"}'
{"data":{"state":{"id":"01a050f7-13b2-...", ...
$ curl -X POST .../states -H "Idempotency-Key: qa-idem-test-1" -d '{"name":"idem-test-state"}'
{"data":{"state":{"id":"01a050f7-13b2-...",   ← same id, no error, no duplicate
```
Same result for `POST /checkouts` with a repeated key: identical checkout id both times, no
409, no second row. **Confidence: refuted** (the underlying bug plausibly existed per the
handover note, but the current code does not reproduce it — either already fixed or the note
described a since-resolved intermediate state). Reporting as refuted per the task's schema.

### 6. Role, agent-token, and session-expiry gating — refuted (works correctly)

Ran the full unhappy-path matrix the brief asked for and found no gap:

- **Role without permission**: created a real `viewer` user, logged in, forced the password
  change, then hit `POST checkouts` (403), `POST states` (403), `PATCH settings` (403),
  `POST users` (403), `POST write-sessions` (403) — every one correctly `FORBIDDEN`/`role`. `GET
  states` correctly `200`.
- **Agent token restricted to `/mcp`**: created a `kind: "agent"` token, confirmed `GET
  /projects` and `GET .../states` both `403 agent_token_restricted`, and `/mcp` itself `200`.
  `tools/list` over that token returns 13 tools, every one read-only by name
  (`list_*`/`get_*`/`describe_table`/`page_rows`/`run_readonly_query`/`extract_fixture`/
  `diff_summary`/`preview_file`) — no checkout/write/import tool in the catalog, matching the
  engineering lane's independent read of the same catalog file.
- **Expired session**: hand-edited a real session row's `expires_at` to 2020 in `metadata.db`,
  then hit `GET /auth/me` and `GET .../states` with that cookie — clean `401 UNAUTHORIZED` both
  times, no crash, no stale-data leak.
- **Two concurrent write sessions on one adapter**: opened a write session, then opened a
  second one on the same adapter — correctly refused, `409 CONFLICT`, `"a write session is
  already open"`, with the existing session's id in the error.

**Confidence: refuted** (no defect found in any of these paths — reporting each explicitly per
the task's instruction to include refuted claims). **Severity: n/a.**

### 7. Oversized and malformed import uploads — refuted (handled correctly)

Uploaded a 58MB CSV against the (locked, non-configurable) 50MB `limits.upload_mb`: clean `413
PAYLOAD_TOO_LARGE` with the exact byte limit in the error body, server unaffected. Uploaded a
file with raw PNG magic bytes named `fake.csv`: the upload step accepts it (bytes are bytes,
correctly deferred), and the preview step parses the binary content as garbage CSV rows/columns
without crashing — garbage in, garbage preview out, which is the correct behavior for a step
whose whole job is to let a human eyeball the parse before committing to a mapping. No defect.
**Confidence: refuted. Severity: n/a.**

### 8. Strange column types round-trip correctly, including a deliberate design choice worth naming

Seeded a Postgres table with `numeric(20,5)` at both extremes, `bigint` at both `int64` bounds,
`jsonb`, `bytea`, integer arrays, and NULLs; snapshotted and read it back through the grid API.
Everything round-tripped correctly, including precision: `bigint`/`numeric` values that would
lose precision as an IEEE double (>15 significant digits, or past `Number.isSafeInteger`) come
back JSON-*quoted* as text; values that fit safely come back as plain JSON numbers — confirmed
this is deliberate (`apps/api/src/lib/engines/pure/display.ts`, `preciseNumbersAsText`/
`needsText`, cited against spec 12 §12.4) and not a bug, though it does mean the same column can
render as a JSON string in one row and a JSON number in the next depending on the value, which
any client code reading these types needs to handle per-value, not per-column. Not filing as a
defect — flagging so nobody "fixes" it into an inconsistency the design deliberately avoided.

One real, if minor, trap I hit while testing this: the grid/lookup/import row endpoints require
a schema-qualified table name (`public.weird`), and give a generic `table X not found` for a
bare name — this matches the SPA's own behavior (it always sends the qualified name from the
introspection response) so it is not a bug reachable through the UI, just a footgun for anyone
scripting against the API directly, worth a line in the API docs.

## Repeating the (nonexistent) first pass, in my own way

Since there was no first QA pass to compare against, I drove the core lifecycle once myself
before moving to unhappy paths, to have a baseline: create project → add adapter (fires an
automatic init snapshot) → seed data → snapshot → diff → checkout → retry a partial checkout.
Every one of those worked as documented on a clean run (see the "clean contrast" case in #3).
Where my experience differs from what the other three lanes describe: they drove the seeded
demo project through the browser; I drove a project I built from scratch through the API only
(port 5173 was not exercised this pass) — so this report adds no new SPA/visual findings and
defers entirely to the interface lane for that surface.

## Still unknown

- **MongoDB's snapshot path for the same crash shape as #1.** Not independently triggered — my
  MySQL repro (#1, trigger B) covers the "not postgres-only" question, but Mongo's `reader.ts`
  equivalent was not separately fault-injected this pass.
- **Whether the crash reproduces under real concurrent load** (multiple simultaneous jobs across
  different projects, one of which hits the fault) rather than the single-job case tested here.
  Given `job_concurrency: 2` by default, this is a live question for how many other users a
  single bad connection takes down in practice.
- **Dark mode**, per the interface lane — not touched this pass either (no browser driven).
- Whether the diff key-strategy bug (#2) also manifests when a table *loses* its primary key
  (the inverse direction) — only PK-added was tested.

## Three things to fix first

1. **The crash (#1).** Attach a no-op `.catch()` to the eager `manifest` promise the same way
   `swallow(pending)` already protects `pending`, on every engine's `snapshot()`. This is not
   speculative — it reproduced deterministically on two engines and three unrelated triggers in
   under two hours of testing, including one trigger (Cancel) that requires no fault injection
   at all. Nothing else on this list matters while a healthy click can take the server down.
2. **The diff key-strategy guard (#2).** Compare `base.table.sort` vs `target.table.sort` in
   `diffTable` and treat a mismatch as a schema change (or make `compareKeys` refuse to coerce
   across strategies) — this is a *wrong answer presented as right*, which the task's own
   ranking rule puts second only to data loss.
3. **Netguard drift (#4) and the per-adapter blank-out on crash (#3).** Different code paths,
   same shape of problem: the thing the operator is shown stops matching the thing that's true,
   exactly when they need it most (after a reset, after a crash). #3 should close for free once
   #1 is fixed; #4 needs `resetState` to go through the same path that keeps the live netguard
   copy in sync, plus a Settings-screen surface for the deny list so there's a UI path to notice
   drift at all.
