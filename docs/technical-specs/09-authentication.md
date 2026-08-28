# 9. Authentication and Authorization

## 9.1 Mechanisms

| Client | Mechanism | Lifetime | Revocation |
| --- | --- | --- | --- |
| Dashboard | Opaque session in an `HttpOnly`, `SameSite=Strict` cookie, path = base path | 12 h idle, 7 d absolute | Logout, password change, admin disable, admin reset |
| Automation | Bearer token `tst_<32 random bytes, base64url>`, kind `standard` | Optional expiry | Admin revoke; tokens are independent of their creator |
| AI agent | Bearer token of kind `agent`, role `viewer`, accepted only on `/api/v1/mcp` | Expiry required, default 90 days, maximum 365 | Admin revoke |
| Bootstrap | `TESTATE_ADMIN_USER` and `TESTATE_ADMIN_PASSWORD` create the first admin when `users` is empty | First login forces a change | The environment values are ignored once a user exists |

An `Actor` is `{ kind: "user" | "token"; id; role; projectIds: string[] | null; label }`. Middleware resolves it once per request and stores it on the Hono context; services receive it as an argument.

## 9.2 Login flow

```text
POST /api/v1/auth/login { username, password }
  -> user missing or disabled           -> 401 UNAUTHORIZED (same message as bad password)
  -> locked_until > now                 -> 429 RATE_LIMITED, Retry-After
  -> argon2id verify fails              -> failed_login_count += 1; lock at 5; 401
  -> ok                                 -> counters reset; session inserted; cookie set
                                          -> 200 { data: { user, must_change_password } }
must_change_password = true
  -> every route except auth.changePassword, auth.logout, auth.me, health -> 403 FORBIDDEN { reason: "password_change_required" }
POST /api/v1/auth/password { current, next }
  -> min length 12; not equal to current -> update hash; must_change_password = 0; revoke every other session
```

## 9.3 Token flow

```text
POST /api/v1/tokens { name, role, project_ids | null, expires_at? }   (admin)
  -> role <= creator role; project_ids validated
  -> plaintext returned once; prefix and hash stored
Authorization: Bearer tst_...
  -> hash lookup; revoked_at or expires_at in the past -> 401
  -> per-token budget (limits.token_requests_per_minute) -> 429
  -> last_used_at updated at most once per minute
Idempotency-Key: <opaque>   on POST that creates a job
  -> (hash, token_id) lookup within 24 h -> the same job returned with 200 or 202
```

## 9.4 Role matrix

Roles are cumulative. A cell shows the minimum role.

| Action | viewer | qa | admin |
| --- | --- | --- | --- |
| View projects, adapters (no secrets), states, tree, checkouts, diffs, jobs, audit log, tables, files | yes | | |
| Run read-only query, export result, download file, download diff | yes | | |
| Create, edit project | | yes | |
| Create, edit, rename adapter; tighten to read-only; test connection | | yes | |
| Loosen adapter to sandbox | | | yes |
| Add or replace a sealed credential | | yes | |
| Take state, protect, rename, tag, delete unprotected state, archive download, archive upload | | yes | |
| Checkout, force checkout, retry | | yes | |
| Start write session, inline edit, write-mode query, MongoDB write forms | | yes | |
| Import: mappings, dry run, run, rejected rows | | yes | |
| Create diff | | yes | |
| REST requests: create, run; hooks: create, order | | yes | |
| Accept SFTP host key | | yes | |
| Cancel a job | own jobs: qa | | any: admin |
| Delete adapter (with return to init) | | yes | |
| Delete project (with return to init) | | | yes |
| Users, tokens, settings, backup, store migration, deny list | | | yes |
| Reset-state (non-production only) | | | yes |
| Tools menu (hash, random, UUID) | yes | | |
| Column policies: create, edit, remove | | yes | lock: admin |
| Insert and edit forms, bulk insert, FK-checks toggle | | yes | |
| Extract fixture | yes (masked) | raw | |
| Agent access through MCP | agent-kind token only, masked | | |

A `viewer` token or user never triggers a job. A `qa` token scoped to one project cannot list or touch another project.

## 9.5 Scope enforcement

| Route pattern | Check |
| --- | --- |
| `/projects` list | filter to `actor.projectIds` when not null |
| `/projects/:slug/**` | `slug` resolves to an id in `actor.projectIds`, else `404 NOT_FOUND` (existence is not revealed) |
| `/jobs`, `/audit-logs` | rows filtered to scoped projects; instance-level rows (backup, storage migration) visible to admin only |
| `/users`, `/tokens`, `/settings` | admin only, tokens included |

## 9.6 Password and session rules

| Rule | Value |
| --- | --- |
| Minimum length | 12 characters; no composition rules; a breached-password list is out of scope |
| Hash | argon2id, Bun defaults (memory 64 MiB, iterations 2, parallelism 1) |
| Temporary password | Set by admin, forced change on first use |
| Lockout | 5 failures, 15 minutes, per username; audit row `auth.locked` |
| Session touch | `last_seen_at` updated at most once per minute to limit writes |
| Cookie attributes | `HttpOnly; SameSite=Strict; Path=<base path>; Secure` when HTTPS; no `Domain` |
| Concurrent sessions | Allowed; listed on the account page; each revocable |

## 9.7 Audit actions

`auth.login`, `auth.login_failed`, `auth.locked`, `auth.logout`, `auth.password_changed`, `user.created`, `user.updated`, `user.disabled`, `user.deleted`, `user.password_reset`, `token.created`, `token.revoked`, `adapter.created`, `adapter.updated`, `adapter.credential_replaced`, `adapter.mode_tightened`, `adapter.mode_loosened`, `adapter.deleted`, `adapter.disabled_by_policy`, `project.created`, `project.updated`, `project.deleted`, `state.created`, `state.protected`, `state.unprotected`, `state.deleted`, `state.archived`, `state.imported`, `checkout.created`, `checkout.retried`, `checkout.forced`, `write_session.started`, `write_session.ended`, `import.run`, `hook.run`, `diff.created`, `settings.updated`, `settings.deny_list_changed`, `store.migrated`, `backup.created`, `host_key.accepted`, `reset_state.run`, `policy.created`, `policy.updated`, `policy.removed`, `policy.locked`, `write_session.fk_checks_off`, `fixture.extracted`, `agent.tool_call`. Each row carries actor, target, project slug, adapter name, details, and outcome.
