# 19. System

Module: `ops` ([../technical-specs/05-module-definitions.md §5.17](../technical-specs/05-module-definitions.md)). Policy: [07 §7.8](../technical-specs/07-security.md). Boot: [22](../technical-specs/22-base-path-and-boot.md).

## 19.1 `GET /health`

**Purpose.** Liveness for everyone; the dependency breakdown for admins (story 129).

**Access.** Public; details with an `admin` session or token.

**Output.** `200` public: `{ "data": { "status": "ok" } }`. Admin:

```json
{ "data": { "status": "ok", "version": "1.2.0", "boot_id": "01J...", "uptime_s": 86400, "env": "production",
  "checks": {
    "metadata_db": { "status": "ok", "latency_ms": 1 },
    "data_dir": { "status": "ok", "free_bytes": 53687091200 },
    "snapshot_store": { "status": "ok", "driver": "local", "latency_ms": 12 },
    "dispatcher": { "status": "ok", "running": 1, "queued": 0, "last_tick_at": "..." },
    "log_sink": { "status": "ok" },
    "sealed_keys": { "status": "ok", "active_fingerprint": "9f3c...", "extra_values": 0 } } } }
```

`status` is `down` when `metadata_db` or `data_dir` fails (HTTP `503`), `degraded` when the store, sink, dispatcher, or `sealed_keys` check is not `ok` (HTTP `200`). **Traceability.** Story 129.

## 19.2 `GET /health/live` and `GET /health/ready`

**Purpose.** Probes for the proxy and orchestrator. **Access.** Public. **Output.** `204`; `ready` answers `503` until boot finished. **Traceability.** Story 129.

## 19.3 `POST /admin/reset-state`

**Purpose.** Reset Testate's own metadata and local store to a seed, for dev and QA of Testate itself.

**Access.** `admin`. **Mounted only when `TESTATE_ENV` is not `production`**: the router registration is conditional, so in production the path does not exist and answers `404 NOT_FOUND` like any unknown route ([07 §7.8](../technical-specs/07-security.md), [11 §11.5](../technical-specs/11-environment-configuration.md)).

**Input.** Body: `seed` `dev` | `qa` optional (default `TESTATE_RESET_SEED`); `confirm` string required, must equal `"reset"`.

**Behavior.** Refuse while jobs run (`JOB_IN_PROGRESS`, checked only against jobs already `running`, not `queued`); refuse when `TESTATE_ADMIN_PASSWORD` is unset (`CONFLICT`), since the reset recreates the bootstrap admin from it; drop every metadata table; re-apply migrations; recreate the bootstrap admin; run the seed (`dev`: admin, `qa` and `viewer` users with known passwords, project `demo` with adapters at the compose engines, a storage adapter at MinIO, one manual state; `qa`: admin only); re-apply the settings that were just dropped to whatever the live process holds in memory. All sessions go with the metadata tables, the caller's included. The code does not pause the dispatcher, does not delete local blobs, uploads, import artifacts, or diff blobs, and does not write an audit row for the reset itself, whatever earlier prose or the tech spec may say.

**Output.** `200 { "data": { "seed": "dev", "users": 3, "projects": 1, "adapters": 5, "states": 1, "warnings": [], "sessions_revoked": true, "duration_ms": 4120 } }`. `warnings` lists adapters the compose engines refused (not running, wrong port) — never fatal. **Errors.** `JOB_IN_PROGRESS`, `CONFLICT` (`TESTATE_ADMIN_PASSWORD` unset), `VALIDATION_ERROR`, `NOT_FOUND` in production. **Traceability.** Testing decisions in `../PRD.md` §5; [05 §5.17](../technical-specs/05-module-definitions.md).

## 19.4 `GET /openapi.json` and `GET /docs`

**Purpose.** The generated OpenAPI document and the interactive reference (story 116). **Access.** Any authenticated, non-agent actor — a session or bearer token, in every environment; there is no unauthenticated development bypass. An HTML request with no actor redirects to `/login` instead of `401`. **Output.** `200 application/json`; `200 text/html`. **Traceability.** Story 116.
