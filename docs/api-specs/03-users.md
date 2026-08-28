# 3. Users

Module: `users` ([../technical-specs/05-module-definitions.md §5.3](../technical-specs/05-module-definitions.md)). Data: [../technical-specs/06-data-model.md §6.3](../technical-specs/06-data-model.md).

User object:

```json
{ "id": "01J...", "username": "dina.qa", "display_name": "Dina Putri", "role": "qa",
  "must_change_password": false, "disabled_at": null, "locked_until": null,
  "last_login_at": "2026-08-28T08:00:00.000Z", "created_at": "...", "updated_at": "..." }
```

## 3.1 `GET /users`

**Purpose.** List accounts. **Access.** `admin`. **Input.** Query: `cursor`, `limit`, `sort` (`username`, `created_at`, `last_login_at`), `order`, `role`, `disabled` (boolean), `q` (username or display name contains). **Output.** `200` list. **Traceability.** Stories 3, 4.

## 3.2 `POST /users`

**Purpose.** Create a user with a temporary password.

**Access.** `admin`.

**Input.** Body: `username` string required, `[a-z0-9._-]{3,64}`, unique case-insensitively; `display_name` string required; `role` required; `temporary_password` string required, 12 characters minimum.

**Behavior.** Hash the temporary password; set `must_change_password`; audit `user.created` (story 3). The password is never returned; the admin hands it over out of band.

**Output.** `201` user. **Errors.** `CONFLICT` (username taken); `VALIDATION_ERROR`. **Traceability.** Story 3.

## 3.3 `GET /users/{id}`

**Access.** `admin`. **Output.** `200` user. **Errors.** `NOT_FOUND`.

## 3.4 `PATCH /users/{id}`

**Purpose.** Change display name or role. **Access.** `admin`. **Input.** Body: `display_name`?, `role`?.

**Behavior.** Refuse demoting the last enabled admin (`CONFLICT`); audit `user.updated`.

**Output.** `200` user. **Errors.** `CONFLICT`, `NOT_FOUND`, `VALIDATION_ERROR`. **Traceability.** Story 4.

## 3.5 `POST /users/{id}/disable` and `POST /users/{id}/enable`

**Purpose.** Block or restore login. **Access.** `admin`. **Behavior.** Disable sets `disabled_at` and revokes every session; refuses the last enabled admin. Enable clears it. Audit `user.disabled` or `user.updated`. **Output.** `200` user. **Errors.** `CONFLICT`, `NOT_FOUND`. **Traceability.** Story 4.

## 3.6 `DELETE /users/{id}`

**Purpose.** Remove the account. **Access.** `admin`. **Behavior.** Refuse the last enabled admin and the caller's own account; revoke sessions; audit rows keep `actor_label` text; audit `user.deleted`. **Output.** `204`. **Errors.** `CONFLICT`, `NOT_FOUND`. **Traceability.** Stories 4, 109.

## 3.7 `POST /users/{id}/reset-password`

**Purpose.** Set a temporary password that must change on next login. **Access.** `admin`. **Input.** Body: `temporary_password` string required, 12 characters minimum. **Behavior.** Hash; set `must_change_password`; revoke every session; clear lockout; audit `user.password_reset`. **Output.** `204`. **Errors.** `NOT_FOUND`, `VALIDATION_ERROR`. **Traceability.** Story 5.
