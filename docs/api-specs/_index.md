# API Specification

## Testate REST API v1 (plus the MCP agent surface)

**Version:** 1.0.0  
**Date:** 2026-08-28  
**Author:** Tech Lead  
**Status:** Sprint 0 scaffold; every operation answers the contract with typed mock data  
**Base URL:** `${TESTATE_BASE_PATH}/api/v1`  

---

## Operation Status Tracker

Legend: `OK` implemented and tested · `WIP` in progress · `TODO` not started · `SCAFFOLD` stub returning a mock.

| Resource | Operation | Status |
| --- | --- | --- |
| Authentication | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/password`, `GET/DELETE /auth/sessions` | OK |
| Tokens | `GET /tokens`, `POST /tokens`, `DELETE /tokens/{id}` | OK |
| Users | `GET /users`, `POST /users`, `GET /users/{id}`, `PATCH /users/{id}`, `POST .../disable`, `POST .../enable`, `DELETE /users/{id}`, `POST .../reset-password` | OK |
| Projects | `GET /projects`, `POST /projects`, `GET /projects/{slug}`, `PATCH`, `GET .../head`, `GET .../quota`, `GET .../deletion-plan`, `POST .../deletion` | OK |
| Adapters | `GET .../adapters`, `POST .../adapters/test`, `POST .../adapters`, `GET .../adapters/{id}`, `PATCH`, `POST .../mode`, `POST .../retest`, `GET .../deletion-plan`, `POST .../deletion` | OK (probe SCAFFOLD) |
| Data | `GET .../schema`, `GET .../tables/{table}/rows`, `GET .../lookup`, `POST .../write-sessions`, `PATCH/DELETE .../write-sessions/{sid}`, `POST .../row-edits`, `POST .../query`, `POST .../query/export`, `GET .../queries`, `DELETE .../queries/{query_id}`, saved queries, `GET .../query-history`, policies, `POST .../fixture` | SCAFFOLD |
| Imports | `POST .../uploads`, `POST .../imports/preview`, mappings, `POST .../imports`, `GET .../imports`, `GET .../imports/{run_id}`, `GET .../rejected`, `GET .../tables/{table}/sample` | SCAFFOLD |
| States | `GET .../states`, `GET .../states/tree`, `POST .../states`, `GET .../states/{id}`, `PATCH`, `DELETE`, `GET .../archive`, `GET .../uploads/{upload_id}/archive-manifest`, `POST .../states/import` | SCAFFOLD routes; init snapshot, blobs, manifests, HEAD real |
| Checkouts | `POST .../checkouts/preflight`, `POST .../checkouts`, `GET .../checkouts`, `GET .../checkouts/{id}`, `POST .../retry`, `POST .../terminate-blockers`, `GET .../counters`, `POST .../repair-counters` | SCAFFOLD routes; return-to-init real (Postgres) |
| Diffs | `POST .../diffs`, `GET .../diffs`, `GET .../diffs/{id}`, `GET .../rows`, `GET .../export`, `DELETE` | SCAFFOLD |
| Storage | `GET .../entries`, `GET .../entries/stat`, `GET .../entries/preview`, `GET .../entries/download`, `POST .../host-key/accept` | SCAFFOLD |
| REST requests | requests CRUD, `POST .../run`, `GET .../runs` | SCAFFOLD |
| Hooks | `GET/POST .../hooks`, `PATCH/DELETE .../hooks/{id}`, `PUT .../hooks/order` | SCAFFOLD |
| Jobs | `GET /jobs`, `GET /jobs/{id}`, `POST /jobs/{id}/cancel`, `GET /jobs/{id}/events` | OK |
| Audit logs | `GET /audit-logs`, `GET /audit-logs/export` | OK |
| Settings | `GET /settings`, `PATCH /settings`, `POST /settings/store-migration`, `POST /settings/backup`, `GET /settings/backups/{job_id}` | SCAFFOLD |
| Tools | `POST /tools/hash`, `POST /tools/random`, `POST /tools/uuid` | OK |
| Agent (MCP) | `POST /mcp`, `GET /mcp`: `initialize`, `tools/list`, `tools/call` (13 tools), `resources/list`, `resources/read`, `ping` | SCAFFOLD |
| System | `GET /health`, `GET /health/live`, `GET /health/ready`, `POST /admin/reset-state` (non-production), `GET /openapi.json`, `GET /docs` | OK |

## Files in This Directory

| File | Contents |
| --- | --- |
| [01-conventions.md](01-conventions.md) | Transport, envelope, status and error codes, pagination, jobs and `wait`, idempotency, sealed fields, roles |
| [02-authentication.md](02-authentication.md) | Login, sessions, password, API tokens |
| [03-users.md](03-users.md) | User management |
| [04-projects.md](04-projects.md) | Projects, HEAD, quota, deletion plan and delete |
| [05-adapters.md](05-adapters.md) | Adapters of every kind, test, retest, mode, deletion |
| [06-data.md](06-data.md) | Schema, rows, lookups, write sessions, row edits, queries, saved queries, history, policies, fixtures |
| [07-imports.md](07-imports.md) | Uploads, preview, mappings, runs, rejected rows, sample files |
| [08-states.md](08-states.md) | States, tree, archive download and import |
| [09-checkouts.md](09-checkouts.md) | Preflight, checkout, retry, blockers, counters |
| [10-diffs.md](10-diffs.md) | Diffs, rows, export |
| [11-storage.md](11-storage.md) | Browse, preview, download, host keys |
| [12-rest-requests.md](12-rest-requests.md) | Saved requests and runs |
| [13-hooks.md](13-hooks.md) | Hooks and order |
| [14-jobs.md](14-jobs.md) | Job object, list, wait, cancel, SSE |
| [15-audit-logs.md](15-audit-logs.md) | Audit rows and export |
| [16-settings.md](16-settings.md) | Settings, store migration, backup |
| [17-tools.md](17-tools.md) | Hash, random, UUID |
| [18-agent-mcp.md](18-agent-mcp.md) | MCP transport, methods, tools, errors |
| [19-system.md](19-system.md) | Health, readiness, reset-state, OpenAPI |

## Companion Documents

| Document | Purpose |
| --- | --- |
| [../technical-specs/_index.md](../technical-specs/_index.md) | Architecture, modules, data model, ad-hoc specs this contract projects |
| [../PRD.md](../PRD.md) | Stories cited in every operation's traceability |
| [../adr/0001-dbengine-interface.md](../adr/0001-dbengine-interface.md) | The engine port behind data, states, checkouts, diffs |
| [../CODING_STANDARD.md](../CODING_STANDARD.md) | Rules the implementation follows |
| [../CODE_REVIEW_CHECKLIST.md](../CODE_REVIEW_CHECKLIST.md) | What moves a row from SCAFFOLD to OK |
