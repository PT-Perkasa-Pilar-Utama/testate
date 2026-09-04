# 2. Authentication and Tokens

Module: `auth` ([../technical-specs/05-module-definitions.md §5.2](../technical-specs/05-module-definitions.md)). Rules: [../technical-specs/09-authentication.md](../technical-specs/09-authentication.md).


A project-scoped token answers `403 FORBIDDEN { "reason": "token_is_project_scoped" }` on `/users`,
`/tokens` and `/settings`, whatever role it carries. Those are not project resources, and two of
them are a way out of the scope (09 §9.4).

## 2.1 `POST /auth/login`

**Purpose.** Start a dashboard session with username and password.

**Access.** Public.

**Input.** Body: `username` string required; `password` string required.

**Behavior.**
1. Before any lookup, check the client address against `limits.failed_logins_per_minute`; over budget answers `429` with `Retry-After` (07 §7.5). Only a failed guess spends budget, charged after step 4. A refusal that is itself a lockout does not spend it, so an already-locked account is not charged twice.
2. Look up the user by username, case-insensitively. Missing or disabled users fail like a wrong password (story 1).
3. If `locked_until` is in the future, answer `429` with `Retry-After` (story 7).
4. Verify argon2id. On failure increment `failed_login_count`; audit `auth.login_failed`. At five, set `locked_until` fifteen minutes ahead and also audit `auth.locked`.
5. On success reset the counter, insert a session (idle 12 h, absolute 7 d), set the cookie, audit `auth.login` (story 8).

**Output.** `200`

```json
{ "data": { "user": { "id": "01J...", "username": "dina.qa", "display_name": "Dina Putri", "role": "qa" },
            "must_change_password": true } }
```

**Errors.** `UNAUTHORIZED` 401 wrong credential; `RATE_LIMITED` 429 locked account or over the per-address budget (07 §7.5); `VALIDATION_ERROR` 400.

**Traceability.** Stories 1, 2, 7, 8.

## 2.2 `POST /auth/logout`

**Purpose.** End the current session. **Access.** Any session. **Input.** None. **Behavior.** Delete the session row; clear the cookie; audit `auth.logout`. **Output.** `204`. **Errors.** `UNAUTHORIZED`. **Traceability.** Story 8.

## 2.3 `GET /auth/me`

**Purpose.** The current actor and what the UI must gate on. **Access.** Any session or token. **Input.** None.

**Output.** `200`

```json
{ "data": { "actor": { "kind": "user", "id": "01J...", "label": "dina.qa", "role": "qa", "agent": false },
            "must_change_password": false, "project_scope": null, "env": "production" } }
```

`project_scope` is null for users and unscoped tokens, else the list of project ids. `env` is included for admins only.

**Errors.** `UNAUTHORIZED`. **Traceability.** Story 2.

## 2.4 `POST /auth/password`

**Purpose.** Change the caller's own password. This route carries no `requireRole`, which is what enforces the forced-change gate (09 §9.2). So it stays reachable while a change is required. `POST /auth/logout`, `GET /auth/me`, `GET /auth/sessions` and `DELETE /auth/sessions/{id}` carry no `requireRole` either, for the same reason.

**Access.** Any user session. **Input.** Body: `current` string required; `next` string required, 12 characters minimum, different from `current`.

**Behavior.** Verify `current`; hash `next`; clear `must_change_password`; revoke every other session of the user (story 9); audit `auth.password_changed`.

**Output.** `204`. **Errors.** `UNAUTHORIZED` (wrong current); `VALIDATION_ERROR`; `FORBIDDEN` 403 `{ "reason": "session_required" }` for a bearer token. The route has no `requireRole`, so the service's `requireUser` check is the only thing that turns a token away. **Traceability.** Stories 2, 6, 9.

## 2.5 `GET /auth/sessions` and `DELETE /auth/sessions/{id}`

**Purpose.** List the caller's sessions (id, created, last seen, ip, user agent, `current` flag) and revoke one. **Access.** Any user session. **Output.** `200` list; `204` on delete. **Errors.** `NOT_FOUND` for another user's session; `FORBIDDEN` 403 `{ "reason": "session_required" }` for a bearer token, for the same reason as `POST /auth/password`. **Traceability.** Story 8.

## 2.6 `GET /tokens`

**Purpose.** List API tokens. **Access.** `admin`. **Input.** Query: `cursor`, `limit`, `sort` (`name`, `created_at`, `last_used_at`, `expires_at`; default `created_at`), `order` (default `desc`), `q` (name or prefix contains), `kind` (`standard` | `agent`), `revoked` (boolean).

**Output.** `200` list of `{ id, name, kind, role, project_ids, prefix, created_by, created_at, last_used_at, expires_at, revoked_at }`. Never the token.

**Traceability.** Stories 111, 112, 134.

## 2.7 `POST /tokens`

**Purpose.** Create a token; the plaintext is returned once.

**Access.** `admin`.

**Input.** Body:

| field | type | required | notes |
| --- | --- | --- | --- |
| `name` | string | yes | 1 to 80 characters |
| `kind` | `standard` \| `agent` | no | default `standard` |
| `role` | `admin` \| `qa` \| `viewer` | yes for standard | default `viewer` for an agent token; `qa` is allowed, `admin` on an agent token is a validation error |
| `project_ids` | string[] \| null | no | null = all projects; each id must exist |
| `expires_at` | timestamp \| `null` | no | absent takes a default: standard tokens never expire, agent tokens expire 90 days out. Explicit `null` on either kind means never-expires. A given value is capped at 365 days ahead for agent tokens only |

**Behavior.** Generate 32 random bytes; store SHA-256 and the 8-character prefix; audit `token.created` (stories 111, 134).

**Output.** `201`

```json
{ "data": { "token": "tst_5Gk...", "record": { "id": "01J...", "name": "ci-shop", "kind": "standard", "role": "qa", "project_ids": ["01J..."], "prefix": "5Gk8x2Qp", "expires_at": null } } }
```

**Errors.** `VALIDATION_ERROR`; `NOT_FOUND` (project id). **Traceability.** Stories 111, 134.

## 2.8 `DELETE /tokens/{id}`

**Purpose.** Revoke. **Access.** `admin`. **Behavior.** Set `revoked_at`; audit `token.revoked`; in-flight requests with the token fail on their next call. **Output.** `204`. **Errors.** `NOT_FOUND`. **Traceability.** Story 112.
