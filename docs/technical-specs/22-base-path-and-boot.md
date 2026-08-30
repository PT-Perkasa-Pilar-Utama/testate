# 22. Base Path and Boot

Testate ships one prebuilt image that must serve under any sub-path, survive upgrades, recover interrupted work, and stop cleanly. This document is the single source for the base-path mechanism, the boot sequence, the pre-migration copy, the backup job, and graceful shutdown. Cite it.

## 22.1 Decision matrix

| Concern | Decision | Rationale |
| --- | --- | --- |
| Base path at build | Vite `base: "/__TESTATE_BASE__/"`; every asset URL and `import.meta.env.BASE_URL` carries the placeholder | Vite resolves `base` at build time; one image must serve any path |
| Base path at boot | Copy `/app/web` to `${TESTATE_DATA_DIR}/run/web/`, replacing `/__TESTATE_BASE__/` with the configured path in `.html`, `.js`, `.css`, and `.json` files; the directory is deleted and rebuilt on every boot | Boot-fresh: an image upgrade never serves stale assets |
| API prefix | `${TESTATE_BASE_PATH}/api/v1`; the SPA reads the base from `<base href>` in the rewritten `index.html` | One variable drives assets, API, router, cookies |
| Cookie path | `Path=${TESTATE_BASE_PATH}` | Two Testates on one host do not share cookies |
| Own hostname | Boot warns and health reports `origin_shared` when `TESTATE_PUBLIC_URL`'s host equals a REST adapter's host | 07 §7.2 |
| Boot order | keys → data dir → pre-migration copy → migrations → sealed sweep → base path rewrite → bootstrap admin → admin password reset → job recovery → retention sweep → dispatcher → listen | Each step can refuse before anything later runs |
| Admin password reset | `TESTATE_ADMIN_PASSWORD_RESET=true` with `TESTATE_ADMIN_PASSWORD` gives the account named by `TESTATE_ADMIN_USER` that password, forces a change, ends its sessions, and clears its lockout. It never creates or promotes an account: an unknown name, or a name that is not an admin, refuses the boot (exit 78). A framed banner names the user, never the password, and says to remove the flag | The last admin cannot reset itself, and no other account may delete or demote it (03 §3.4); whoever sets the variable already owns the volume |
| Pre-migration copy | `metadata.db` copied to `${TESTATE_DATA_DIR}/run/metadata-<boot_id>.db` before migrations; the last three kept | Story 118: an upgrade can roll back |
| Readiness | `/health/ready` returns 204 only after "listen"; `/health/live` from the first moment the process serves | Orchestrators can wait |
| Shutdown | `SIGTERM`: stop accepting jobs, stop the HTTP listener after in-flight responses, ask running jobs to cancel at the next batch (SQL transactions roll back), wait up to 30 s, mark still-running jobs `interrupted`, close the database, exit 0 | PRD story 121 |
| Backup job | PAX tar of `metadata.db` (consistent copy through the SQLite backup API) plus, optionally, every referenced blob; written to a download stream or to the snapshot store; manifest lists key fingerprints | Story 117 |
| Restore from backup | Documented in the deployment plan: stop, replace `/data` contents, start with the same key list | Story 117 |

## 22.2 Boot sequence

```text
 0. read env through lib/config                          refuse on any invalid value (11 §11.4)
 1. loadKeyRing                                          refuse per 17 §17.5
 2. ensure ${DATA_DIR}/{blobs,logs,uploads,imports,run}  refuse when not writable
 3. copy metadata.db -> run/metadata-<boot_id>.db         keep last 3; skip when the db does not exist yet
 4. open SQLite (WAL, busy_timeout 5000, foreign_keys on); migrate()
 5. sealed sweep; banner
 6. rewrite web assets -> run/web/                         delete first, then copy and replace placeholder
 7. bootstrap admin when users is empty                    refuse when TESTATE_ADMIN_PASSWORD is missing
 8. reset the admin password when TESTATE_ADMIN_PASSWORD_RESET is set   banner; refuse on a bad name
 9. jobs.recover()                                         interrupted jobs, HEAD unknown, pins, uploads
10. retention sweep (logs, stashes, diffs, history, imports, audit)
11. start dispatcher; start retention timer (daily)
12. listen on PORT; /health/ready -> 204; boot wide event with every step's counts
```

Total budget: under 10 s on a warm volume (08 §8.3). Every refusal prints a framed message naming the step, the cause, and the fix, and exits with code 78 (configuration error).

## 22.3 Base-path rewrite

```text
input:  /app/web (from the image), TESTATE_BASE_PATH (validated: starts with "/", no trailing "/", or exactly "/")
output: ${DATA_DIR}/run/web
steps:  rm -rf output; copy tree; for each *.html, *.js, *.css, *.json, *.webmanifest: replace "/__TESTATE_BASE__/" with base + "/"
        (base "/" yields "/"); write <base href="<base>/"> into index.html
serve:  Hono serveStatic at base for /assets/*; every other non-API path under base returns index.html
```

Why rewrite rather than serve `base: "./"`: relative asset URLs break under history-API routing for nested paths, and the SPA needs the absolute base to build API URLs and cookies.

## 22.4 Shutdown sequence

```text
SIGTERM received:
  1. dispatcher.pause()                   no new jobs start
  2. server.stop(graceful)                stop accepting; in-flight responses finish; SSE streams get a final "status: shutting_down" and close
  3. for each running job: signal.abort() runners stop at the next batch; SQL transactions roll back; Mongo leaves partial (result unknown)
  4. wait up to 30 s for runners
  5. remaining running jobs -> interrupted (recovery rules apply at the next boot as well)
  6. flush logger; close SQLite; exit 0
SIGKILL: nothing runs; the next boot's recovery handles it
```

## 22.5 Backup job

```text
backup job (admin):
  1. SQLite online backup of metadata.db to run/backup-<job>.db
  2. manifest.json: { version, testate_version, created_at, key_fingerprints: [kids present], include_blobs, blob_count, blob_bytes }
  3. PAX tar stream: manifest.json, metadata.db, blobs/<hash>... (when include_blobs)
  4. destination: download stream, or the snapshot store under backups/<timestamp>.tar
  5. delete run/backup-<job>.db
```

The backup contains sealed values as sealed; a restore needs the listed key fingerprints in `TESTATE_SECRETS_ACTIVE_KEY`.

## 22.6 Performance targets

| Path | Target | Source |
| --- | --- | --- |
| Boot to ready | under 10 s warm | 08 §8.3 |
| Asset rewrite | under 1 s for 5 MB of assets | Estimate |
| Shutdown | under 30 s | PRD story 121 |
| Backup of metadata only | under 5 s for 1 GB | SQLite backup API |

## 22.7 Security constraints

`run/` is inside `/data`, owned by the container user; the root filesystem stays read-only. The rewrite touches only the copied tree. Pre-migration copies and backups contain sealed values only in sealed form. The bootstrap password is read once and never logged.

## 22.8 Component and contract

`modules/ops/{ops.boot.ts, ops.basepath.ts, ops.shutdown.ts, ops.backup.job.ts, ops.health.ts, ops.reset-state.ts}`, `apps/api/src/index.ts` (composition root calls `boot()` then `listen()`). Locked: the boot order, the placeholder string, the `run/` layout, the backup manifest.

## 22.9 What this does not do

- No zero-downtime upgrade; one instance restarts.
- No automatic restore from backup.
- No HTTPS termination; the proxy does it.
- No sub-path per project; one base path per instance.

## 22.10 Cross-references

| Concern | Source |
| --- | --- |
| Environment | 11 |
| Keys and sweep | [17-sealed-values.md](17-sealed-values.md) |
| Recovery rules | [16-jobs-runtime.md](16-jobs-runtime.md) §16.5 |
| Health shape | 05 §5.17 |
| Deployment runbook | `../DEPLOYMENT_PLAN.md` |

## 22.11 Open follow-ups

| Item | Revisit when |
| --- | --- |
| Serve assets from memory instead of `run/web` | Volumes with slow small-file writes make boot slow |
| Scheduled backups | Operators ask; today backups are manual or scripted through the API |
