# 11. Environment Configuration

All configuration enters through `lib/config`, parsed once at boot with a valibot schema. Raw `process.env` or `Bun.env` reads elsewhere are a lint error. Bun loads `.env` in development; the container receives values from compose or the orchestrator.

## 11.1 Variables

| Variable | Type, default | Purpose | development | test (CI) | production |
| --- | --- | --- | --- | --- | --- |
| `PORT` | int, `7378` | Listen port | 7378 | random | 7378 |
| `TESTATE_ENV` | `development` \| `test` \| `production`, default `production` | Gates the reset-state route and dev conveniences | `development` | `test` | `production` |
| `TESTATE_DATA_DIR` | path, `/data` | Volume root | `./data` | temp dir | `/data` |
| `TESTATE_BASE_PATH` | path, `/` | Sub-path the app is served under; asset rewrite, API prefix, cookie path | `/` | `/` | `/` or `/testate` |
| `TESTATE_PUBLIC_URL` | url, optional | Absolute links in downloads; own-hostname warning against REST adapters | `http://localhost:7379` | unset | `https://testate.example.internal` |
| `TESTATE_SECRETS_ACTIVE_KEY` | list of base64 32-byte keys, required | Sealed values; first key seals | one key | one key | one key, two during rotation |
| `TESTATE_SECRETS_ACCEPT_UNREADABLE` | bool, `false` | Declared-loss mode | `false` | `false` | `false` unless recovering |
| `TESTATE_ADMIN_USER` | string, `admin` | Bootstrap admin when `users` is empty | `admin` | `admin` | set |
| `TESTATE_ADMIN_PASSWORD` | string, required when `users` is empty | Bootstrap password, forced change | set | set | set once, then removable |
| `TESTATE_ADMIN_PASSWORD_RESET` | bool, `false` | Gives `TESTATE_ADMIN_PASSWORD` to the admin named above and forces a change (22 §22.2) | `false` | `false` | `false` unless recovering |
| `TESTATE_TRUST_PROXY` | bool, `false` | Honor `X-Forwarded-*` and `X-Request-Id` | `false` | `false` | `true` behind nginx |
| `TESTATE_MAX_UPLOAD_MB` | int, `50` | Import and archive upload limit | 50 | 10 | 50 |
| `TESTATE_JOB_CONCURRENCY` | int, `2` | Global job cap | 2 | 2 | 2 to 4 |
| `TESTATE_STORE` | `local` \| `s3`, optional | Snapshot store driver; when set, locks the setting in the UI | unset | unset | optional |
| `TESTATE_S3_BUCKET`, `TESTATE_S3_PREFIX`, `TESTATE_S3_REGION`, `TESTATE_S3_ENDPOINT`, `TESTATE_S3_ACCESS_KEY_ID`, `TESTATE_S3_SECRET_ACCESS_KEY`, `TESTATE_S3_VIRTUAL_HOSTED` | strings, bool | S3 store when `TESTATE_STORE=s3` | unset | MinIO in the contract job | as needed |
| `TESTATE_LOG_DIR` | path, `${TESTATE_DATA_DIR}/logs` | Wide-event files | default | temp | default |
| `TESTATE_LOG_RETENTION_DAYS` | int, `30` | Rolling window | 30 | 1 | 30 |
| `TESTATE_LOG_STDOUT` | bool, `true` | Mirror events to stdout | `true` | `false` | `true` |
| `TESTATE_LOG_SAMPLE_RATE` | float, `1.0` | Default keep rate for successful fast requests | 1.0 | 1.0 | 1.0 |
| `TESTATE_LOG_SLOW_MS` | int, `2000` | Slow-request threshold, always kept | 2000 | 2000 | 2000 |
| `TESTATE_LOG_STACKS` | bool, `false` | Include stack traces in error sections | `true` | `true` | `false` |
| `TESTATE_RESET_SEED` | `dev` \| `qa`, `qa` | Default seed for reset-state when the body omits it | `dev` | `qa` | ignored (route absent) |

Everything else (retention counts, quotas, limits, deny list, rate budgets) lives in `settings` and is edited by an admin; environment values override only where the table says so.

## 11.2 Precedence and locking

| Setting | Environment wins? | UI behavior when the environment sets it |
| --- | --- | --- |
| Snapshot store driver and S3 config | Yes | Fields read-only with the note "set by environment" |
| Job concurrency | Yes | Read-only |
| Upload limit | Yes | Read-only |
| Log settings | Yes | Not in the UI |
| Everything else | No | Editable |

## 11.3 Example files

`deploy/.env.example`:

```dotenv
PORT=7378
TESTATE_ENV=production
TESTATE_DATA_DIR=/data
TESTATE_BASE_PATH=/
TESTATE_PUBLIC_URL=https://testate.example.internal
TESTATE_SECRETS_ACTIVE_KEY=<bun scripts/generate-key.ts>
TESTATE_ADMIN_USER=admin
TESTATE_ADMIN_PASSWORD=<change-on-first-login>
TESTATE_TRUST_PROXY=true
TESTATE_MAX_UPLOAD_MB=50
TESTATE_JOB_CONCURRENCY=2
# TESTATE_STORE=s3
# TESTATE_S3_BUCKET=testate-states
# TESTATE_S3_PREFIX=prod/
# TESTATE_S3_REGION=ap-southeast-1
# TESTATE_S3_ENDPOINT=https://minio.example.internal
# TESTATE_S3_ACCESS_KEY_ID=
# TESTATE_S3_SECRET_ACCESS_KEY=
# TESTATE_S3_VIRTUAL_HOSTED=false
```

Development `.env` at the repository root adds `TESTATE_ENV=development`, `TESTATE_DATA_DIR=./data`, `TESTATE_LOG_STACKS=true`, `TESTATE_RESET_SEED=dev`, and the compose engine addresses the `dev` seed uses.

## 11.4 Validation at boot

Boot refuses to start, before any write, when: `TESTATE_SECRETS_ACTIVE_KEY` is missing, malformed, duplicated, longer than five keys, or cannot open stored sealed values (17 §17.5); `TESTATE_DATA_DIR` is not writable; `TESTATE_STORE=s3` without bucket and credentials; `TESTATE_ADMIN_PASSWORD` is missing while the `users` table is empty or while `TESTATE_ADMIN_PASSWORD_RESET` is set; `TESTATE_ADMIN_USER` names nobody, or names an account that is not an admin, while that reset is set; `TESTATE_BASE_PATH` does not start with `/` or ends with `/` (except `/` itself). Every refusal names the variable and the fix.

## 11.5 Reset-state gating

`TESTATE_ENV` is the only gate. `development` and `test` mount `POST /api/v1/admin/reset-state`; `production` does not register the route. There is no separate enable flag, so a production deployment cannot enable it by mistake; enabling it requires changing `TESTATE_ENV`, which also changes cookie and log behavior and is visible on the health endpoint (`env` field for admins).
