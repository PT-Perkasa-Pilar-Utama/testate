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
1. Look up the user by username, case-insensitively. Missing or disabled users fail like a wrong password (story 1).
2. If `locked_until` is in the future, answer `429` with `Retry-After` (story 7).
3. Verify argon2id. On failure increment `failed_login_count`; at five set `locked_until` fifteen minutes ahead; audit `auth.login_failed`.
4. On success reset the counter, insert a session (idle 12 h, absolute 7 d), set the cookie, audit `auth.login` (story 8).

**Output.** `200`

```json
{ "data": { "user": { "id": "01J...", "username": "dina.qa", "display_name": "Dina Putri", "role": "qa" },
            "must_change_password": true } }
```

**Errors.** `UNAUTHORIZED` 401 wrong credential; `RATE_LIMITED` 429 locked; `VALIDATION_ERROR` 400.

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

**Purpose.** Change the caller's own password; the only mutating route allowed while a change is required.

**Access.** Any user session. **Input.** Body: `current` string required; `next` string required, 12 characters minimum, different from `current`.

**Behavior.** Verify `current`; hash `next`; clear `must_change_password`; revoke every other session of the user (story 9); audit `auth.password_changed`.

**Output.** `204`. **Errors.** `UNAUTHORIZED` (wrong current); `VALIDATION_ERROR`. **Traceability.** Stories 2, 6, 9.

## 2.5 `GET /auth/sessions` and `DELETE /auth/sessions/{id}`

**Purpose.** List the caller's sessions (id, created, last seen, ip, user agent, `current` flag) and revoke one. **Access.** Any user session. **Output.** `200` list; `204` on delete. **Errors.** `NOT_FOUND` for another user's session. **Traceability.** Story 8.

## 2.6 `GET /tokens`

**Purpose.** List API tokens. **Access.** `admin`. **Input.** Query: `cursor`, `limit`, `kind` (`standard` | `agent`), `revoked` (boolean).

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
| `role` | `admin` \| `qa` \| `viewer` | yes for standard | agent tokens are always `viewer`; a role on an agent token is a validation error |
| `project_ids` | string[] \| null | no | null = all projects; each id must exist |
| `expires_at` | timestamp | agent: yes | agent tokens: default 90 days, maximum 365 days ahead; standard: optional |

**Behavior.** Generate 32 random bytes; store SHA-256 and the 8-character prefix; audit `token.created` (stories 111, 134).

**Output.** `201`

```json
{ "data": { "token": "tst_5Gk...", "record": { "id": "01J...", "name": "ci-shop", "kind": "standard", "role": "qa", "project_ids": ["01J..."], "prefix": "5Gk8x2Qp", "expires_at": null } } }
```

**Errors.** `VALIDATION_ERROR`; `NOT_FOUND` (project id). **Traceability.** Stories 111, 134.

## 2.8 `DELETE /tokens/{id}`

**Purpose.** Revoke. **Access.** `admin`. **Behavior.** Set `revoked_at`; audit `token.revoked`; in-flight requests with the token fail on their next call. **Output.** `204`. **Errors.** `NOT_FOUND`. **Traceability.** Story 112.
