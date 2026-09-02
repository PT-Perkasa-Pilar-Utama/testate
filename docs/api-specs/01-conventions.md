# 1. Conventions

Every operation in this set follows the rules here. Resource files cite this document and do not restate it.

## 1.1 Base address and transport

| Item | Value |
| --- | --- |
| Base URL | `${TESTATE_BASE_PATH}/api/v1`; documented as `/api/v1` |
| Content type | Requests and responses `application/json; charset=utf-8`; uploads `multipart/form-data`; job events `text/event-stream`; downloads their own type with `Content-Disposition: attachment` |
| Field names | `snake_case` on the wire; the `@testate/shared` schemas use the wire names |
| Ids | UUID version 7 strings; states may also be addressed by name where an operation says so |
| Timestamps | ISO-8601 UTC with milliseconds, `2026-08-28T10:23:45.612Z` |
| Numbers from target databases | Integers within 2^53 as JSON numbers; larger integers and decimals as strings marked by the column type |
| Request id | `X-Request-Id` accepted (when `TESTATE_TRUST_PROXY`) or generated; always echoed |
| Versioning | Path only (`/api/v1`); breaking changes bump the path |
| OpenAPI | `GET /api/v1/openapi.json` (generated from the same schemas), interactive reference at `GET /api/v1/docs` (story 116) |

## 1.2 Authentication

| Client | Mechanism | Notes |
| --- | --- | --- |
| Dashboard | Cookie `testate_session` (HTTP-only, `SameSite=Strict`, `Path` = base path) | Mutating requests (`POST`, `PATCH`, `PUT`, `DELETE`) must carry `X-Testate-Request: 1`, else `403 FORBIDDEN { "reason": "csrf" }` |
| Automation | `Authorization: Bearer tst_<token>` | Token kind `standard`; role and project scope from the token |
| AI agent | `Authorization: Bearer tst_<token>` of kind `agent` | Accepted only on `/api/v1/mcp` (18); any other route answers `403 { "reason": "agent_token_restricted" }` |

Authentication rules, lifetimes, and lockout: [../technical-specs/09-authentication.md](../technical-specs/09-authentication.md).

## 1.3 Roles and scope

Roles are cumulative: `admin` ⊇ `qa` ⊇ `viewer`. Each operation names its minimum role. The full matrix is [../technical-specs/09-authentication.md §9.4](../technical-specs/09-authentication.md). Project-scoped tokens see only their projects; a slug outside the scope answers `404 NOT_FOUND`, never `403`.

| Role | Adds |
| --- | --- |
| `viewer` | Read everything in scope, read-only queries, downloads, tools, masked fixtures |
| `qa` | Create and edit projects, adapters, states, normalizers, policies; checkout, import, write sessions, row edits; tighten to read-only; delete adapters |
| `admin` | Users, tokens, settings, backup, store migration, deny list; loosen to sandbox; lock policies; delete projects; reset-state outside production |

## 1.4 Envelope

Success, single object:

```json
{ "data": { "id": "01J...", "slug": "shop" } }
```

Success, collection:

```json
{ "data": [ { "id": "01J..." } ], "page": { "next_cursor": "eyJ...", "limit": 50 } }
```

Error:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "body.name must be 1 to 120 characters",
             "details": { "issues": [ { "path": "body.name", "message": "must be 1 to 120 characters" } ] } } }
```

`details` is an object or absent. Job-backed operations return the job object (14 §14.1) in `data` and a `Location: /api/v1/jobs/{id}` header.

## 1.5 Status codes

| Status | Used for |
| --- | --- |
| `200` | Get, list, update, synchronous actions, a `wait` that reached a terminal job |
| `201` | Create of a resource that exists at once |
| `202` | Every job-backed operation, including job-backed deletes of projects, adapters, and states; body is the job |
| `204` | Inline delete, logout, session revoke |
| `400` | `VALIDATION_ERROR` |
| `401` | `UNAUTHORIZED` |
| `403` | `FORBIDDEN`, `ADAPTER_READ_ONLY` |
| `404` | `NOT_FOUND` (also out-of-scope projects) |
| `409` | `CONFLICT`, `SCHEMA_DRIFT`, `JOB_IN_PROGRESS`, `CHECKOUT_BLOCKED`, `QUOTA_EXCEEDED` |
| `413` | `PAYLOAD_TOO_LARGE` |
| `422` | `ENGINE_UNSUPPORTED`, `HOST_BLOCKED` |
| `429` | `RATE_LIMITED` with `Retry-After` |
| `502` | `ADAPTER_UNREACHABLE` |
| `500` | `INTERNAL` |

## 1.6 Error codes

| Code | Status | Condition |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Body, query, or path failed the schema; `details.issues[]` names each path |
| `UNAUTHORIZED` | 401 | Missing, expired, or revoked credential; wrong password |
| `FORBIDDEN` | 403 | Role too low, CSRF header missing, password change required (`reason: "password_change_required"`), agent token off `/mcp`, standard token on `/mcp` |
| `ADAPTER_READ_ONLY` | 403 | Write requested on a `read_only` adapter |
| `NOT_FOUND` | 404 | Resource absent or outside the token's scope |
| `CONFLICT` | 409 | Uniqueness (slug, name, username), state-machine refusal, last admin, protected state, stale deletion plan, idempotency key reused with a different body, host key changed |
| `SCHEMA_DRIFT` | 409 | Live schema differs from the state; `details` carries `tables` and `columns` |
| `JOB_IN_PROGRESS` | 409 | Another job holds one of the adapters; `details.job_id` |
| `CHECKOUT_BLOCKED` | 409 | Lock wait exceeded; `details.blocking_sessions[]`, `details.terminable` |
| `QUOTA_EXCEEDED` | 409 | Project quota or instance ceiling reached; `details.used_bytes`, `details.limit_bytes` |
| `PAYLOAD_TOO_LARGE` | 413 | Body over 1 MiB or upload over `TESTATE_MAX_UPLOAD_MB` |
| `ENGINE_UNSUPPORTED` | 422 | Engine below the floor, operation outside the adapter's tier, missing privilege at planning; `details.reason` |
| `HOST_BLOCKED` | 422 | Address policy refused the target; `details.reason`, `details.matched` |
| `RATE_LIMITED` | 429 | Account locked or token budget spent; `Retry-After` seconds |
| `ADAPTER_UNREACHABLE` | 502 | Connection, authentication, or timeout against the target; `details.engine_code` when available |
| `INTERNAL` | 500 | Unexpected failure; the request id is in the response header |

## 1.7 Pagination, sorting, filtering

| Parameter | Rule |
| --- | --- |
| `cursor` | Opaque string from the previous `page.next_cursor`; absent for the first page |
| `limit` | Default 50, maximum 200; grid rows default 100, maximum 500 |
| `sort` | One field from the operation's allowed list; default `created_at` |
| `order` | `asc` or `desc`; default `desc` |
| Filters | Query parameters named per operation; repeated parameters mean OR within a field, AND across fields |

## 1.8 Jobs, wait, idempotency

| Item | Rule |
| --- | --- |
| Job-backed operation | Returns `202` with the job and `Location`; poll `GET /jobs/{id}` or stream `GET /jobs/{id}/events` |
| `wait` | `?wait=<1..300>` on any job-creating POST and on `GET /jobs/{id}`: the response waits until the job is terminal or the seconds pass; `200` when terminal, `202` when still running |
| `Idempotency-Key` | Optional header on job-creating POSTs; scoped per token; the same key returns the same job for 24 hours; the same key with a different body answers `409 CONFLICT` |
| Adapter exclusivity | A job on a busy adapter answers `409 JOB_IN_PROGRESS`; a job beyond the global cap is accepted and queued with `queue_position` |

## 1.9 Sealed fields

Write: send the plain value, or the string `"keep"` on update to leave it unchanged. Read: never the value; always `{ "set": true, "set_at": "...", "key_fingerprint": "9f3c..." }` or `{ "set": false }`. Applies to `password`, `connection_string`, `access_key_id`, `secret_access_key`, `private_key`, `passphrase`, and the S3 store keys.

## 1.10 Rate limit headers

`RateLimit-Limit` and `RateLimit-Remaining` on every token-authenticated response; `Retry-After` on `429`.

## 1.11 Table addressing

A table path parameter is `schema.table` URL-encoded (`public.orders` → `public.orders`, `sales.order items` → `sales.order%20items`). MongoDB collections use the bare collection name. Column policies and lookups use the same form.

## 1.12 Common objects

| Object | Shape |
| --- | --- |
| `actor` | `{ "kind": "user" \| "token", "id", "label", "role", "agent": boolean }` |
| `job` | See 14 §14.1 |
| `sealed` | `{ "set": boolean, "set_at"?: string, "key_fingerprint"?: string }` |
| `table_ref` | `{ "schema": string \| null, "name": string }` |
| `engine_warning` | `{ "code": string, "table"?: string, "column"?: string, "message": string }` |
