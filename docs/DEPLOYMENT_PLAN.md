# Deployment Plan

One image, one volume, one process. Design: [technical-specs/22-base-path-and-boot.md](technical-specs/22-base-path-and-boot.md), [11-environment-configuration.md](technical-specs/11-environment-configuration.md).

## Requirements

| Item | Value |
| --- | --- |
| Host | Docker 24+ with Compose v2; 1 CPU, 1 GiB RAM minimum |
| Volume | `/data`: metadata.db, blobs, logs, uploads, `run/`. Size it for snapshots; states are compressed data dumps |
| Network | Outbound to every target database, file store, and REST host; inbound from the proxy only |
| Proxy | TLS termination; `client_max_body_size` above `TESTATE_MAX_UPLOAD_MB`; buffering off for `/jobs/*/events` (SSE) |

## Install

```sh
mkdir -p /opt/testate && cd /opt/testate
curl -O https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/testate/main/deploy/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/testate/main/deploy/.env.example
openssl rand -base64 32          # -> TESTATE_SECRETS_ACTIVE_KEY
# edit .env: key, TESTATE_ADMIN_PASSWORD, TESTATE_PUBLIC_URL, TESTATE_BASE_PATH, TESTATE_TRUST_PROXY=true
docker compose up -d
docker compose logs -f testate   # wait for the boot event
```

Open the public URL. Sign in as `TESTATE_ADMIN_USER` with `TESTATE_ADMIN_PASSWORD`. Change the password when asked. Remove `TESTATE_ADMIN_PASSWORD` from `.env`; it is read only while the users table is empty.

## Sub-path

Set `TESTATE_BASE_PATH=/testate` (leading slash, no trailing slash). Boot rewrites the SPA assets and serves everything under that path; the API answers at `/testate/api/v1`; the session cookie carries `Path=/testate`. `deploy/nginx.conf` is the matching proxy block. Two instances on one host need two base paths.

## Boot refusals

Boot stops before any write and prints a framed message with the variable and the fix. Exit code 78. Common ones:

| Message | Fix |
| --- | --- |
| `TESTATE_SECRETS_ACTIVE_KEY is not set` | Generate a key, set it, restart |
| `TESTATE_DATA_DIR is not writable` | Fix the volume owner (`uid 1000`, user `bun`) |
| `TESTATE_ADMIN_PASSWORD is missing while the users table is empty` | Set it for the first boot |
| `TESTATE_ADMIN_PASSWORD: required by TESTATE_ADMIN_PASSWORD_RESET` | Set the new password, or unset the reset flag |
| `TESTATE_ADMIN_USER: no user named <name>` | Name an account that exists; the reset never creates one |
| `TESTATE_ADMIN_USER: <name> is not an admin` | Name an admin; the reset never promotes an account |
| `TESTATE_STORE=s3 needs TESTATE_S3_BUCKET and TESTATE_S3_ACCESS_KEY_ID` | Complete the S3 block or unset `TESTATE_STORE` |
| `no stored sealed value opens with the configured key(s)` | See [KEY_ROTATION.md](KEY_ROTATION.md) |

## Forgotten password

An admin resets any other account under **Users**: the account gets a temporary password, must
change it at the next login, loses every session it had, and leaves its lockout behind. Hand the
temporary password over out of band — Testate sends no mail.

Nobody can reset the last admin, and nothing may delete or demote it. That account recovers through
the environment instead:

```bash
# .env, on the host that runs the container
TESTATE_ADMIN_USER=admin              # the account to recover; the default
TESTATE_ADMIN_PASSWORD=<a new one>    # what it becomes
TESTATE_ADMIN_PASSWORD_RESET=true

docker compose -f deploy/docker-compose.yml up -d --force-recreate
docker compose -f deploy/docker-compose.yml logs --tail 20 testate   # the banner names the account
```

Sign in with that password, change it when asked, then **remove `TESTATE_ADMIN_PASSWORD_RESET` and
`TESTATE_ADMIN_PASSWORD` and restart**. While the flag is set, every restart resets that password
again to whatever the environment holds.

This grants nothing the environment did not already have: whoever edits `.env` also holds the
volume. It refuses rather than guessing — an unknown name, or a name that is not an admin, stops the
boot with exit 78 and changes nothing.

## Health

| Path | Use |
| --- | --- |
| `GET /api/v1/health/live` | 204 as soon as the process serves; the container `HEALTHCHECK` |
| `GET /api/v1/health/ready` | 204 after boot finishes; the orchestrator's readiness probe |
| `GET /api/v1/health` | `{ status }` for everyone; the full breakdown (db, volume, store, dispatcher, log sink, key fingerprint) for admins |

## Upgrade

```sh
docker compose pull
docker compose up -d
```

Boot copies `metadata.db` to `run/metadata-<boot_id>.db` before migrations (last three kept), migrates, sweeps sealed values, rebuilds the web assets, recovers interrupted jobs, and only then listens. A failed migration leaves the copy in place: stop, restore the copy over `metadata.db`, run the previous image.

## Backup and restore

Backup: **Settings → Back up** (or `POST /api/v1/settings/backup`) produces a tar with `manifest.json`, a consistent `metadata.db`, and optionally every referenced blob. Schedule it with a cron that calls the API with a `qa` or `admin` token.

Restore:

1. `docker compose stop testate`
2. Replace the contents of the `/data` volume with the tar's `metadata.db` and `blobs/`
3. Make sure `TESTATE_SECRETS_ACTIVE_KEY` lists every `kid` in `manifest.json`
4. `docker compose start testate`

## Shutdown

`docker compose stop` sends `SIGTERM`. Target behaviour (spec 22 §22.4): the API stops accepting jobs, finishes in-flight responses, asks running jobs to cancel at their next batch (SQL transactions roll back), waits up to 30 s, marks the rest `interrupted`, and exits 0. `stop_grace_period: 35s` in the compose file covers it. Sprint 0 status: the process stops the listener and exits at once; the drain lands with the jobs card. A `SIGKILL` is handled by the next boot's recovery.

## Logs

One JSON line per request or job in `/data/logs/testate-YYYY-MM-DD.jsonl`, mirrored to stdout, kept `TESTATE_LOG_RETENTION_DAYS` (30) days. Ship the files or the container stdout; both carry the same events. Credentials never appear: sealed values are a type the logger refuses.

## Development engines

`docker compose -f deploy/compose.engines.yml up -d` starts PostgreSQL (54320), MySQL (33060), MariaDB (33070), MongoDB (27017), and MinIO (9000) with user `testate` / password `testate`. Not for production.

## Checklist before go-live

- [ ] TLS at the proxy; `TESTATE_TRUST_PROXY=true`
- [ ] `TESTATE_PUBLIC_URL` set; health does not report `origin_shared`
- [ ] Key stored in the secret manager; rotation runbook read
- [ ] Bootstrap password removed from `.env`; `TESTATE_ADMIN_PASSWORD_RESET` unset
- [ ] A second admin account exists, so a forgotten password needs no restart
- [ ] Volume backed up on a schedule; restore rehearsed once
- [ ] Target databases reachable from the container; sandbox adapters use a dedicated database user
