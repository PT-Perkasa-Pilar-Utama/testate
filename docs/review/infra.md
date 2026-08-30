# Infra / deployment review

Second pass on top of the first reviewer's report. Scope: reproduce their claims against a
locally built image (`docker build -f deploy/Dockerfile -t testate-review:local .`, 295MB,
matches their number), then look at what a container build/boot review alone doesn't cover — CI
workflows, version drift, test coverage for the boot path, docs vs. code.

Ports used: 3200-3201 (freed). Containers/volumes created this session (`testate-review-ok`,
`testate-review-rodata`, `testate-review-ro`, `testate-review-migbase`, plus the `migtest` image)
were all removed; `testate-review:local` was `docker rmi`'d at the end. The shared engines
(`deploy-postgres-1`, `deploy-mysql-1`, etc.) were never touched.

## Verdict

**No.** Not on Monday, not as-is. Two of the four fields the health endpoint advertises to admins
are lies (`snapshot_store` is always `"ok"`, `origin_shared` is always `false`, neither derived
from anything), and a bad volume mount or a bad migration — the two most ordinary ops mistakes —
crash with a raw stack trace and exit 1 instead of the documented framed refusal at exit 78. None
of this loses data (verified: the pre-migration copy survives both crash scenarios), and the
request-time gates that matter for safety (prod 404 on reset-state, read-only-rootfs boot, secrets
never logged) do hold up under reproduction. So it's not unsafe to run, but it will mislead an
on-call engineer reading `/health` during an incident, and it will hand that engineer a raw Bun
stack trace instead of the runbook message the deployment plan promises. Fix the two fake health
checks and the two raw-crash paths first; everything else here is either confirmed-fine or polish.

## What the team confirmed, ranked

### 1. `snapshot_store` health check is hardcoded `"ok"` — never probed (new, not in the first report)

`apps/api/src/modules/ops/ops.service.ts:60`:

```ts
snapshot_store: { status: "ok", driver: deps.storeDriver, latency_ms: 0 },
```

A literal, not a check. `grep -rn "ping\|healthCheck\|HeadBucket" apps/api/src/lib/blobstore/`
returns nothing — there is no reachability probe for the S3 or local blob store anywhere in the
codebase, wired or not. `docs/PRD.md:454` documents the admin health check as covering
"metadata database, data directory writable, snapshot store reachable, dispatcher heartbeat" —
three of those four are real (`checkDb`, `checkDataDir` with `accessSync(dir, W_OK)`, and
`deps.dispatcher()`); "snapshot store reachable" is not. `apps/api/src/modules/ops/ops.test.ts`
never asserts on `report.checks.snapshot_store` — so nothing would fail if this literal were
deleted tomorrow. If the configured S3 bucket goes unreachable (wrong creds, bucket deleted,
network partition), the operator's `/health` still reports `"ok"` for the exact field that would
tell them why every checkout is failing.

**Confidence: confirmed.** Read the source (no probe exists), read the test (no assertion exists),
read the doc claim (contradicts the code).

### 2. `origin_shared` self-check is dead code — confirms the first reviewer

`apps/api/src/wiring.store.ts:140`: `originShared: false,` — a literal. `TESTATE_PUBLIC_URL` is
parsed at `apps/api/src/lib/config/index.ts:34` and, per
`grep -rn TESTATE_PUBLIC_URL apps/api/src`, read nowhere else. `docs/technical-specs/07-security.md:28`
and `22-base-path-and-boot.md:13` both document a boot-time warning and an `origin_shared: true`
health flag when `TESTATE_PUBLIC_URL` shares a host with a configured REST adapter.
`docs/DEPLOYMENT_PLAN.md:136` lists "`TESTATE_PUBLIC_URL` set; health does not report
`origin_shared`" as a go-live checklist item — an item that is *always* true, whether or not the
hostname actually collides, because the field can never become anything but `false`. Sharper than
the first report: the install steps in `docs/DEPLOYMENT_PLAN.md:19` tell every operator to *set*
`TESTATE_PUBLIC_URL` during install — the variable every operator is told to configure is parsed
and then silently discarded.

**Confidence: confirmed.** Reproduced live: booted the image on port 3200, logged in as admin,
`GET /api/v1/health` returned `"origin_shared":false` with a default config where no comparison
was even possible — because none is ever made, for any config.

### 3. Boot-time refusal contract broken for an unwritable data dir and a failed migration — confirms the first reviewer, reproduced independently

Both reproduced live against the container:

**Unwritable `/data`:**
```
$ docker run --name testate-review-rodata --env-file env.ok -v testate-review-rodata:/data:ro testate-review:local
...
EROFS: read-only file system, mkdir '/data/blobs'
      at ensureDirs (/app/src/index.ts:90:5)
      at boot (/app/src/index.ts:100:3)
      at async bootOrRefuse (/app/src/index.ts:319:18)
Bun v1.4.0 (Linux arm64)
$ echo $?
1
```

**Broken migration** (committed a container with an injected `0002_broken.sql` on top of an
already-migrated volume, then ran `bun dist/index.js` explicitly):
```
SQLiteError: near "THIS": syntax error
      at run (bun:sqlite:318:21)
      at <anonymous> (/app/src/lib/db/index.ts:46:10)
      at migrate (/app/src/lib/db/index.ts:53:5)
      at boot (/app/src/index.ts:119:21)
$ echo $?
1
```

`docs/technical-specs/22-base-path-and-boot.md:27` documents step 2 as "ensure
`${DATA_DIR}/{blobs,logs,uploads,imports,run}` refuse when not writable" and
`docs/DEPLOYMENT_PLAN.md:58` lists `TESTATE_DATA_DIR is not writable` as the expected
troubleshooting message. Neither happens: `ensureDirs()` at `apps/api/src/index.ts:88-91` is a bare
loop of `mkdirSync` calls with no try/catch, and `migrate()` at
`apps/api/src/lib/db/index.ts:24-53` has no try/catch around the per-file transaction.
`refuse()` at `apps/api/src/boot.ts:229` only re-frames `ConfigError`/`SealedConfigError` and
rethrows everything else — confirmed by reading the function body:
```ts
export function refuse(cause: unknown): never {
  if (!(cause instanceof ConfigError) && !(cause instanceof SealedConfigError)) throw cause;
  ...
}
```
The rethrow becomes an unhandled rejection at the top-level `await bootOrRefuse()` in
`apps/api/src/index.ts:321` — Bun's default top-level-error behavior (a raw trace, exit 1) is what
runs.

No data loss in either case: `docker run --rm -v testate-review-ok:/data alpine ls /data/run`
showed the pre-migration copy (`metadata-<boot_id>.db`) present and intact after the migration
crash — the copy runs before the migration transaction, so it's unaffected by that transaction
failing.

**Why this specific bug has no regression net (new):** `apps/api/src/boot.test.ts` only tests the
admin-password-reset refusal path; nothing calls `ensureDirs()` or `migrate()` with a hostile
filesystem. CI's `smoke` job (`.github/workflows/ci.yml`) boots the built API directly with a
normal, writable `${{ runner.temp }}` directory — it cannot see this. CI's `image` job builds the
Docker image with `push: false` and never runs it — see CI analysis below. So this bug shipped,
and nothing in the pipeline would catch it shipping again.

**Confidence: confirmed**, both sub-claims, both reproduced live with exit codes captured.

### 4. Contract tests for the database engines never execute in CI (new)

`apps/api/src/lib/engines/{postgres,mysql,mongodb}/*.contract.test.ts`,
`apps/api/src/lib/files/files.contract.test.ts`, and
`apps/api/src/lib/blobstore/s3.contract.test.ts` (1002 lines, 26 `test(...)` blocks across the
five files) each open with `describe.skipIf(!(await reachable()))(...)` — they silently skip when
the target engine isn't reachable. `.github/workflows/ci.yml`'s `check` job runs `bun test` (via
`bun run complete-check`) with no compose engines started — every one of these skips there. The
only job that starts `deploy/compose.engines.yml` is `e2e`, and `e2e` runs `bun run e2e`
(Playwright), never `bun test`. So the actual trigger matrix is:

| Trigger | Jobs that run | Engines up? | `bun test` runs contract suites? |
| --- | --- | --- | --- |
| push to `main` | `check`, `smoke` | no | no (skipped) |
| pull request | `check`, `smoke`, `image`, `e2e` | only in `e2e`, which doesn't call `bun test` | no (skipped) |
| tag `v*` | same as PR | same | no (skipped) |
| `workflow_dispatch` on `ci.yml` | same as PR | same | no (skipped) |
| `workflow_dispatch` on `deploy-image.yml` | builds, slims, pushes | no (`profile.env` boots the app alone, no adapters configured) | n/a, doesn't run `bun test` |

The engine-adapter test suite — the code that actually snapshots and restores a real Postgres,
MySQL, or MongoDB, i.e. the core "git for your database" feature — never runs in any automated
pipeline. It only runs when a developer happens to have the compose engines up locally and runs
`bun test` by hand. `bun run contract` (`scripts/contract.ts`) looks like it should run these; it
doesn't — it's a leftover Sprint-0 stub: `console.log("contract suites: none registered yet
(Sprint 0)")` is the entire body, and it isn't invoked from any CI workflow either.

**Confidence: confirmed** — read every workflow file and every contract test's skip guard; no
engine-adapter test has ever run green or red in CI on this repo as configured.

### 5. Smaller, confirmed items

- **Sourcemap shipped in the fat image** (first reviewer's claim, confirmed the measurable half):
  `docker run --rm testate-review:local sh -c 'du -sh dist/index.js.map dist/index.js'` →
  `6.7M dist/index.js.map`, `3.5M dist/index.js`. `apps/api/package.json`'s build script passes
  `--sourcemap=linked`. `.github/workflows/deploy-image.yml` sets `DSLIM_INCLUDE_PATH: /app`,
  which force-keeps the whole `/app` tree regardless of what docker-slim's runtime probes touch.
  **I did not run docker-slim myself**, so "the map survives into the published slim image" stays
  **plausible**, not confirmed — the fat-image measurement and the force-keep config are both
  confirmed on their own.
- **`ci.yml`'s `image` job never boots the container it builds** — `docker/build-push-action` with
  `push: false` and no follow-up `docker run`. This is *why* finding #3 has no CI safety net: even
  the job whose entire job is "build the Docker image" doesn't exercise the boot sequence.
- **`org.opencontainers.image.url` and `.revision`/`.created` leak from the Bun base image.**
  `deploy/Dockerfile`'s `LABEL` block sets `title`, `description`, `licenses`, `source`, and
  (separately) `version`, but never `url`. Inspecting the built image:
  `org.opencontainers.image.url` reads `"https://github.com/oven-sh/bun"`, and `.revision`/
  `.created` are Bun's own build revision/timestamp, not Testate's — confirmed by diffing labels
  against `oven/bun:1.4-slim@sha256:e0ee...` directly, which carries the identical values.
  Cosmetic, but a registry or scanner reading OCI labels off a published Testate image would list
  Bun's GitHub repo as its source URL.
- **`docs/technical-specs/04-tech-stack.md:86`'s CI description doesn't match `ci.yml`.** It
  claims "unit, API, contract matrix, build, OSV scan"; there is no OSV/vulnerability scan step
  and no "contract matrix" job anywhere in `.github/workflows/ci.yml` — confirms finding #4 from
  the doc side.
- **`docs/PRD.md:451`'s deployment claim doesn't match `deploy-image.yml`.** It says the image is
  "built for amd64 and arm64 on GitHub Release." The actual workflow triggers on
  `workflow_dispatch` only (no `release:` trigger), and neither `docker/build-push-action` nor the
  docker-slim step sets `platforms:` — it's a single-arch build on whatever `ubuntu-latest`
  is (amd64). This PRD line is stale; the newer, more specific docs (`README.md:106`,
  `docs/HANDOVER.md:174`, `docs/technical-specs/04-tech-stack.md:86`) all correctly describe the
  manual-dispatch, no-release-trigger reality — so this is one stale sentence in an aspirational
  early doc, not a live discrepancy anyone would hit following the current README.

### Version manifests — checked, clean

`bun run bump-version --check` → `version 1.0.0-alpha in 5 files`, exit 0. All four `package.json`
files and `apps/api/src/version.ts` agree. One gap: no CI job runs `bump-version --check`, so a
manual edit to one file that skips the script would go undetected until someone runs it by hand or
notices the API report a different version than the image tag.

## What was refuted

Nothing. All three of the first reviewer's findings reproduced exactly as described:
`origin_shared` dead code, the two raw-crash boot refusals (both sub-cases: data dir and
migration), and the 6.7MB sourcemap in the fat image. The only adjustment is splitting finding #3
of their report into "ships in the fat image" (confirmed, measured) vs. "survives into the
published slim image" (plausible, not run).

## Spot-checked from the first report, held up

- Production-mode 404 on `POST /admin/reset-state`: reproduced, `404`.
- `--read-only` root filesystem + `--tmpfs /tmp`: reproduced, container reaches `health/ready` →
  `204` and boots clean.

## Still unknown / not independently re-run

Taken on the first reviewer's word, not re-verified this pass: `TESTATE_ADMIN_PASSWORD_RESET`
recovery flow, sub-path (`TESTATE_BASE_PATH`) asset rewriting, and the backup/download job. No
reason from reading the code to doubt them, but "no reason to doubt" is not the same bar as the
reproduction the other findings got.

Also unknown: whether the sourcemap actually survives a real `docker-slim` pass (would need to run
the `kitabisa/docker-slim-action` locally, which needs network egress this review didn't set up
for); whether `deploy-image.yml` has ever actually been run against a tagged version (no artifact
or registry access from this review to check `ghcr.io/pt-perkasa-pilar-utama/testate` directly).

## Three things to fix first

1. **Make `snapshot_store` and `origin_shared` real checks or remove the claim.** Both are
   currently `true`/`ok` literals presented to an admin as live signal during an incident. Wire
   `snapshot_store` to an actual HEAD/ping against the configured store (S3 `HeadBucket`, or an
   `accessSync` for local) and `origin_shared` to an actual hostname comparison against
   `TESTATE_PUBLIC_URL` and the configured REST adapters — or delete both fields and the doc
   sections that promise them. Either is better than a health check that always says yes.
2. **Wrap `ensureDirs()` and `migrate()` so boot failures hit `refuse()`.** Catch the `mkdirSync`
   and the migration transaction, translate to `ConfigError` (data-dir case) or a new typed boot
   error `refuse()` also handles, so both produce the documented framed message and exit 78 instead
   of a raw stack trace and exit 1. Add the missing regression test alongside — `boot.test.ts`
   currently only covers the admin-reset refusal path.
3. **Put the engine contract tests in CI.** Add a job (or extend `e2e`) that starts
   `deploy/compose.engines.yml` and runs `bun test` (not just Playwright) before tearing the
   engines down, so `postgres.contract.test.ts` / `mysql.contract.test.ts` /
   `mongodb.contract.test.ts` / `files.contract.test.ts` / `s3.contract.test.ts` actually execute
   somewhere other than a developer's laptop. Retire or rewrite `scripts/contract.ts`, which
   currently no-ops and would mislead anyone who runs `bun run contract` expecting it to do
   something.

**Fourth candidate, deliberately not in the top three:** having `ci.yml`'s `image` job actually run
the container it builds (hitting `/health/ready`, at minimum) would have caught #2 in CI before it
shipped. It's real, but it's a smaller, mostly-redundant win once #2 and #3 land — #2 removes the
underlying crash and #3's engine job, if extended slightly, could absorb the same "does the built
artifact actually boot" check more cheaply than adding a fourth Docker run to `ci.yml`.
