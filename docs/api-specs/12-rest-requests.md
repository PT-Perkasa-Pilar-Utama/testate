# 12. REST Requests

Module: `rest` ([../technical-specs/05-module-definitions.md §5.12](../technical-specs/05-module-definitions.md)). Contract with targets: [10 §10.4](../technical-specs/10-integration-points.md). Paths under `/projects/{slug}/adapters/{id}` for adapters of kind `rest`.

Request object:

```json
{ "id": "01J...", "name": "clear-cache", "method": "POST", "path": "/internal/cache/clear",
  "query": { "scope": "all" }, "headers": { "X-Trace": "testate-{{job.id}}" }, "secret_headers": ["X-Internal-Key"],
  "body": "{\"reason\":\"checkout {{state.name}}\"}", "expected_status": 200, "created_at": "...", "updated_at": "..." }
```

Secret header values are sealed; `secret_headers` lists their names.

## 12.1 `GET .../requests`, `POST .../requests`, `GET .../requests/{rid}`, `PATCH`, `DELETE`

**Purpose.** Manage saved requests (story 99). **Access.** `viewer` reads; `qa` writes. **Input (POST, PATCH).** `name` (unique per adapter), `method` (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`), `path` (relative to the adapter's base URL), `query` map, `headers` map, `secrets` map of secret headers (values or `"keep"`), `body` string, `expected_status` integer or null. Placeholders `{{project.slug}}`, `{{state.name}}`, `{{state.id}}`, `{{job.id}}` allowed in path, query, headers, body (story 103). **Behavior.** Unknown placeholders are a `VALIDATION_ERROR`. **Output.** `201` or `200` request; `204` on delete (refused with `CONFLICT` while a hook references it). **Errors.** `CONFLICT`, `NOT_FOUND`, `VALIDATION_ERROR`. **Traceability.** Stories 98, 99, 103.

## 12.2 `POST .../requests/{rid}/run`

**Purpose.** Run a saved request from the dashboard (story 99).

**Access.** `qa`.

**Input.** Body: `placeholders` optional `{ "state": { "id", "name" }, "job": { "id" } }`; `project.slug` is always the current project.

**Behavior.** Expand placeholders; address check on the resolved host (`HOST_BLOCKED`); send with the adapter's timeout and TLS setting; never follow redirects; cap the stored body at 1 MiB; record a run; audit nothing beyond the wide event (hooks audit `hook.run`).

**Output.** `200 { "data": { "run_id": "01J...", "status_code": 200, "duration_ms": 310, "response_headers": {...}, "response_body": "...", "truncated": false, "matched_expected": true } }`.

**Errors.** `HOST_BLOCKED`, `ADAPTER_UNREACHABLE` (timeout, connection error; the run is still recorded), `NOT_FOUND`. **Traceability.** Stories 99, 100.

## 12.3 `GET .../requests/{rid}/runs`

**Purpose.** The last fifty runs (story 100). **Access.** `viewer`. **Input.** Query: `cursor`, `limit`. **Output.** `200` list of `{ id, job_id, hook_run_id, status_code, duration_ms, error, created_at }` with `response_body` on `GET .../runs/{run_id}`. **Traceability.** Story 100.
