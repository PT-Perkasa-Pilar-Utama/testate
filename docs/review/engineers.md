# Testate review — engines & job pipeline

Reviewer: second pass on the same lane (ports 3000/5173). Verifies the first reviewer's four
claims against the real running compose engines, runs the actual gate and the full Playwright
suite myself, and covers ground the first pass skipped (mongo write path, storage backends,
role gating, logging redaction).

Everything below that says "confirmed" I reproduced myself this session — a command I ran, a
file:line I read, or both. Nothing here is relayed on trust.

## Ranking rule

Ordered by what actually hurts someone running this as internal tooling: a wrong answer
presented as right outranks a loud failure that rolls back cleanly, because the loud failure
tells the operator something is wrong and the silent one doesn't. Data loss would outrank both;
none of the four confirmed defects lose data — the restore bug rolls back its transaction, and I
confirmed a related "failed restore leaves the database as it found it" story passes in e2e
(`engine.e2e.ts` story-83, e2e log line for boot project).

## Confirmed (ranked)

### 1. Diff reports every row as both removed and added when the two snapshots' key strategy differs, even for byte-identical data — silent wrong answer

**Severity: major.** `apps/api/src/lib/snapshot/merge.ts:13-14`: `compareKeys` falls back to
`sign(String(a.value), String(b.value))` whenever either side's `SortKey.by` is `"row-hash"`,
stringifying a primary-key tuple against a hash string with no check that both sides agree on
`by`. `diffTable` (`apps/api/src/modules/diffs/diffs.job.ts:33-41`) only compares column *names*
between the two sides (`schemaChanged`), never `base.table.sort` vs `target.table.sort` — so a
table whose primary key was added or dropped between the two snapshot times (column names
unchanged) silently feeds `mergeRows` two streams keyed by different strategies.

This is reachable in production, not just a synthetic call: I checked whether the byte-identical
short-circuit at `diffs.job.ts:61` (`base.table.blob_hash === target.table.blob_hash`) would
mask it. It doesn't — `apps/api/src/lib/snapshot/codec.ts:13` encodes each row as
`{"k":<sort key value>,"r":<row json>}`, so a primary-key tuple (`"k":[1]`) and a row-hash string
(`"k":"a3f8…"`) produce different bytes even when the row payload is identical, so `blob_hash`
differs and the real merge runs.

**My repro** (direct call to the real `mergeRows`, not a mock):
```
$ bun run /tmp/.../mergekeys.ts
stats: { added: 2, removed: 2, changed: 0 }
```
Two identical rows (`{id:1,name:"a"}`, `{id:2,name:"b"}`), base keyed `primary-key`/`[1]`,`[2]`,
target keyed `row-hash`/`"hashA"`,`"hashB"`. The diff claims 2 removed + 2 added for identical
data and 0 correctly matched. Script: `/tmp/claude-.../scratchpad/mergekeys.ts` (deleted after).

**Test gap confirmed:** `apps/api/src/lib/snapshot/merge.test.ts:50-56` exercises `compareKeys`
only with both sides the same `by`. No test mixes them.

**Fix:** in `diffTable`, also compare `base.table.sort` vs `target.table.sort` and treat a
mismatch like a column-name mismatch (every shared row counts as changed), or have
`compareKeys` refuse/throw on `a.by !== b.by` instead of silently coercing to string comparison.

### 2. Postgres restore never refreshes materialized views but reports `status: "restored"` — silent wrong answer

**Severity: major.** `docs/technical-specs/13-checkout-and-restore.md:74` documents step 8:
`REFRESH MATERIALIZED VIEW` for every matview the adapter option lists. I grepped the entire
engine layer and shared package:
```
$ grep -rniE "REFRESH MATERIALIZED|matview|materialized_view" apps/api/src/lib/engines apps/web/src packages/shared/src
(no output)
```
Zero hits anywhere. `restoreAll` in `apps/api/src/lib/engines/postgres/restore.ts:222-252` goes
straight from `COMMIT` to `resetCounters` and returns `status: "restored"` unconditionally — a
database with a materialized view is reported fully restored while the matview still reflects
pre-restore data, with no caveat in the result.

**Fix:** implement the documented step, or strike it from the spec and have the restore result
carry a warning when the schema has matviews.

### 3. Self-referencing FK restore fails outright past the 1000-row batch boundary — loud dead-end, but confirmed data-safe (rolls back)

**Severity: major** (blocks the restore entirely for any self-referencing table over 1000 rows;
downgraded below #1/#2 because it fails loud and clean rather than reporting a wrong answer).

`selectRestoreStrategy` (`apps/api/src/lib/engines/pure/strategy.ts:14`) sets
`triggerDisable = canDisableTriggers && !hasDeferrable` — when the schema has a deferrable FK,
triggers stay ON and restore relies on constraint deferral. But
`apps/api/src/lib/engines/postgres/restore.ts` never issues `SET CONSTRAINTS ALL DEFERRED`
anywhere (confirmed: zero hits in that file; it exists only in the unrelated `import.ts:110` and
`write.ts:110` paths — the latter for the row-edit flow, not checkout). `computeDependencyOrder`
(`apps/api/src/lib/engines/pure/dependency-order.ts:51-55`) computes a `selfReferencing` field
whose own doc comment promises two-phase insert; nothing outside its own test reads it (only
`pure.test.ts:186`).

**My repro**, live against the real engine (`createPostgresEngine().checkout()` on
`deploy/compose.engines.yml` postgres, 54320/shop): a `selfref.nodes(id, parent_id
REFERENCES nodes(id) DEFERRABLE INITIALLY IMMEDIATE)` table, 1500 rows, id-ascending order with
every row's parent a larger id (so the natural snapshot order is child-before-parent past row
1000, since `BATCH_ROWS = 1000` at `restore.ts:25` splits the insert into two statements and each
is checked at end-of-statement, not end-of-transaction, because the FK was never deferred):
```
RESULT: checkout: insert or update on table "nodes" violates foreign key constraint "nodes_parent_id_fkey"
```
Test file left at `apps/api/src/lib/engines/postgres/postgres.contract.support.ts`-based spec,
run from `/tmp/.../scratchpad/selfref.test.ts` (outside the repo, deleted after). Cleanup:
`DROP SCHEMA selfref CASCADE` executed and verified (`\dn` now shows only `contract`/`public`).

**Test gap confirmed:** no `*.test.ts` under `apps/api/src/lib/engines` references `BATCH_ROWS` or
spans a row count over 1000.

**Fix:** issue `SET CONSTRAINTS ALL DEFERRED` after `BEGIN` when `triggerDisable` is false and
`hasDeferrable` is true (mirrors the existing pattern at `write.ts:110`), or implement the
two-phase self-reference insert the `selfReferencing` field was built for. Add a contract test
past the batch boundary in child-before-parent order.

### 4. `restore_mode: "fast"` is a fully inert, dead option — on every SQL engine, not just MySQL/MariaDB

**Severity: minor**, widened from the first reviewer's finding. Confirmed their MySQL claim
(`mysql/restore.ts:184-224` always does `DELETE FROM` inside a transaction, `restoreMode` never
read in that file). I additionally grepped the whole engine layer:
```
$ grep -rn "restoreMode" apps/api/src apps/web/src packages/shared/src
types.ts:99 (type decl), checkouts.restore.ts:152 (writes it into the plan),
mongodb.contract.test.ts / postgres.contract.test.ts / mysql.contract.test.ts (fixtures only, all "atomic")
```
`restoreMode` is read back by **no** engine's `restore.ts` — not MySQL, not Postgres, not
MongoDB. It's fully wired as a user-facing setting (DB column with a CHECK constraint at
`apps/api/src/db/migrations/0001_init.sql:72`, PATCH handler, API schema, a picker in
`apps/web/src/features/adapter/adapter.edit.view.tsx:104-105`) that changes nothing anywhere,
on any engine. Every contract test only ever exercises `"atomic"` — `"fast"` is untested end to
end on every engine, not only the one the first reviewer checked.

**Fix:** implement the documented TRUNCATE-based fast path per engine, or drop the option.

## Refuted

None. All four of the first reviewer's claims reproduced exactly as described; I found no
overstatement in any of them (see the codec check under finding 1, which specifically confirms
their "even byte-identical data" framing rather than refuting it).

## Additional finding (mine, not in the first report)

### 5. Wide-event `error()` bypasses the field-redaction check the rest of the logger enforces

**Severity: minor, confidence: plausible (not confirmed as an active leak).**
`apps/api/src/lib/logger/event.ts`: `add()`, `merge()`, and `push()` all call `assertSafe()`,
which throws on the forbidden keys `password`/`token`/`secret`/`__sealed`/`connection_string`
(line 39). `error()` (lines 118-130) builds its `ErrorSection` directly — `message: error.message`
and `details: extra.details` — and never calls `assertSafe`. So a raw exception message, or an
`AppError`'s `details` object, reaches the wide-event log unredacted regardless of what keys or
text it carries; the guarantee "the logger refuses password/token/secret" only holds for
structured fields set through `add`/`merge`/`push`, not for anything routed through `error()`.

I could not turn this into a confirmed leak: I connected to the real Postgres engine with a
deliberately wrong password and inspected the raw driver exception —
```
MESSAGE: password authentication failed for user "testate"
```
— the server-side error text does not echo the password, matching the comment at
`apps/api/src/lib/engines/postgres/errors.ts:31` ("the message keeps the server text, never the
config"). I did not check the MySQL/MongoDB driver error text as thoroughly, and I did not find
any call site that puts a raw secret into `AppError.details`. Flagging as an inconsistency in the
redaction contract, not a demonstrated leak.

## What I ran myself

- `bun run complete-check` (type-check, lint, fmt, `bun test`, build): **green.**
  `302 pass, 0 fail, 1337 expect() calls, 61 files`, finished in 7.36s. Lint/format/build clean.
  Full log kept at `/tmp/.../scratchpad/complete-check.log` for this session.
- `bunx playwright test` (full suite, all 9 projects, real API + Vite dev server + compose
  engines): **green.** `119 passed, 1 skipped` in 2.6 minutes. The one skip is
  `screens.e2e.ts` ("captures one screen per capability"), which is intentionally gated behind
  `SHOTS=1` per `docs/E2E.md` — not a real gap.
- `.e2e/coverage.md` regenerated by the run: **150/150 stories covered, 0 uncovered, 0 no-screen,
  0 API-only**, matching the README's claim exactly.
- Both the "gate is green" and "150 stories covered by e2e" claims in the README/CLAUDE.md hold
  up under my own run, not just the first reviewer's word.

## What I covered that the first pass skipped

- Confirmed `restore_mode: "fast"` is dead on Postgres and MongoDB too (see finding 4), not just
  MySQL/MariaDB.
- Read-only enforcement at the session level, spot-checked for real: Postgres
  (`BEGIN READ ONLY` / `ROLLBACK`, `postgres/query.ts:77,83`) and MySQL
  (`START TRANSACTION READ ONLY`, `mysql/query.ts:51,68`) both genuinely gate at the DB session,
  not just an application-level label. MongoDB's "Document tier" flatly refuses `mode: "write"`
  in `runQuery` (`mongodb/query.ts:69-71`) and blocks `$out`/`$merge` in aggregation pipelines
  (`mongodb/query.ts:88-93`) — the only two write-capable aggregation stages. I did not test
  whether `$function`/`$accumulator` (arbitrary server-side JS in an aggregation pipeline) is
  reachable through this "read-only" surface; flagging as unknown below.
- `requireRole`/`requireAgentToken` coverage across all 18 routers: no route found unprotected.
  Several routers apply role gating via `router.use(path, requireRole(...))` middleware rather
  than per-route, which made a naive route-count-vs-requireRole-count grep look suspicious
  (`settings.router.ts`, `users.router.ts`, `ops.router.ts`) until I read them — all correctly
  gated. `POST /admin/reset-state` is genuinely wired off in production
  (`apps/api/src/index.ts:210-211`, `TESTATE_ENV === "production"` is the only gate, matching
  CLAUDE.md's claim).
- MCP tool catalog (`apps/api/src/modules/agent/agent.catalog.ts`, 12 tools): every tool I read
  is read-only (list/describe/page/get/extract/preview); no insert/update/delete/checkout/restore
  tool exists in the catalog.
- MySQL/MariaDB contract tests genuinely run against both engines (33060 and 33070) via a
  `TARGETS` loop in `mysql.contract.test.ts:20-32`, not just MySQL — mariadb was not skipped by
  the suite even though the first reviewer didn't mention it.
- Files/blobstore contract tests exist for SFTP, S3/MinIO, and (separately) the blobstore's own
  S3 backend (`files.contract.test.ts`, `blobstore/s3.contract.test.ts`), and ran clean as part
  of the 302-test `bun test` pass.

## Still unknown (not enough budget to chase further)

- Whether MongoDB's `$function`/`$accumulator` aggregation stages are reachable through the
  "read-only" query surface for server-side JS execution — the code blocks only `$out`/`$merge`,
  not these. Untested.
- MySQL/MariaDB and MongoDB driver error text was not checked as exhaustively as Postgres for
  credential echoing (see finding 5) — only Postgres was empirically tested with a bad password.
- `rest.router.ts` (saved REST requests against MinIO) and `hooks.router.ts` (webhooks) were
  checked for route/role wiring only, not for correctness of the request-execution or hook-firing
  logic itself; their behavior is covered only at the e2e level (`flows.e2e.ts`,
  `hooks.e2e.ts`), which I ran and which passed, but I did not read the implementation.
- The FTP-adjacent `deploy-ftp-1` container (ports 21100-21110/21210) was running but I found no
  code path in `apps/api/src/lib/files` that uses plain FTP (only `sftp.ts`, `s3.ts`); did not
  chase whether it's dead compose config or used by another reviewer's lane.
- `apps/api/src/lib/files/ftp.ts` exists (listed by `find`) but I never opened it.

## Coverage judgment: what has no test that would fail if it broke

Four concrete, demonstrated gaps, each already covered as part of the four findings above:

1. No test spans the 1000-row `BATCH_ROWS` boundary for any table, self-referencing or not — a
   silent regression to batch size or to the deferred-constraint pattern above/below that
   threshold ships undetected.
2. No test mixes `SortKey.by` types on the two sides of a merge — a schema-shape mismatch that
   the `schemaChanged` name-only check can't see slips straight into a wrong diff.
3. `restore_mode: "fast"` has never been exercised by a contract test on any engine — every
   fixture hardcodes `"atomic"`. The option could be deleted or set to a no-op silently and no
   test would notice.
4. No test asserts anything about materialized views on restore — not their absence of handling,
   not a warning, nothing. The spec's step 8 could vanish from the doc and nothing would fail.

## Three things to fix first

1. **`SET CONSTRAINTS ALL DEFERRED` in `postgres/restore.ts`** when `triggerDisable` is false and
   `hasDeferrable` is true — smallest fix, mirrors the existing pattern at `write.ts:110`, and it
   is the only one of the four that currently makes restore *fail* (as opposed to silently lying)
   for real schemas with deferrable self-references over 1000 rows.
2. **Key-strategy guard in `diffTable`/`compareKeys`** (finding 1) — this is the worst one:
   it reports a clean, plausible-looking diff (`added: 2, removed: 2`) for identical data, and
   nothing about the output looks wrong to whoever's reading it.
3. **Materialized view refresh, implement or retract the spec line** (finding 2) — currently a
   documented promise with zero code behind it and no caveat in the restore result; whichever way
   it's resolved, the gap between spec and code needs to close, not stay silent.

`restore_mode: "fast"` cleanup (finding 4) is fourth: it's dead but harmless — nothing built on
top of it — so it doesn't cost correctness the way 1-3 do, only trust in the settings UI.

## Session cleanup verified

- Ports 3000 and 5173: free (`lsof -ti` empty) — the Playwright `webServer` processes exited on
  their own after the run finished.
- `selfref` schema on the shared `shop` Postgres database: dropped and verified gone (`\dn` shows
  only `contract` and `public`).
- No stray `bun test`/`playwright`/`vite`/API processes left running (checked via `ps aux`).
- `git status --short`: clean — nothing under source, tests, or config was touched; this report
  is the only file written outside `/tmp`.
