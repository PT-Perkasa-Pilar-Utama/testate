# 15. Audit Logs

Module: `audit` ([../technical-specs/05-module-definitions.md §5.15](../technical-specs/05-module-definitions.md)). Actions: [09 §9.7](../technical-specs/09-authentication.md).

Audit row:

```json
{ "id": "01J...", "actor": { "kind": "user", "id": "01J...", "label": "dina.qa" }, "action": "checkout.created",
  "target_type": "checkout", "target_id": "01J...", "target_label": "orders",
  "project": { "id": "01J...", "slug": "shop" }, "adapter": { "id": "01J...", "name": "orders-db" },
  "details": { "state_name": "seeded-baseline", "force": false }, "outcome": "succeeded",
  "ip": "10.0.4.7", "user_agent": "Mozilla/5.0", "created_at": "..." }
```

`project` and `adapter` keep slug and name as text after their subject is deleted (story 108). `target_label` is the target's name at the time of the event; it is `null` on rows written before the column existed.

## 15.1 `GET /audit-logs`

**Access.** `viewer` (scope-filtered by the token's project scope; every unscoped actor, whatever its role, also sees instance-level rows — there is no role check). **Input.** Query: `cursor`, `limit` (default 50, max 200), `project_id`, `q` (substring match over the actor label, the action, and the target's label or id), `actor` (substring match against the actor label only, not user or token ids), `action` (substring match), `from`, `to` (timestamps), `outcome`. **Output.** `200` list, newest first. **Traceability.** Stories 108, 110.

## 15.2 `GET /audit-logs/export`

**Purpose.** CSV of the filtered rows (story 110). **Access.** `viewer`. **Input.** Same filters as 15.1. **Behavior.** Walks every page the filter matches, using `limit` as the internal page size, and assembles the whole CSV in memory before responding. **Output.** `200 text/csv`, attachment, sent as a single response (not streamed). **Traceability.** Story 110.

## 15.3 `GET /audit-logs/{id}/payload`

**Purpose.** The request and the response behind one row, for the person asking "what exactly was sent, and what came back" (story 108). **Access.** `admin`, under the same project scope as 15.1. Admin only because a stored response was masked by the column policies for whoever made the request, not for whoever reads it here; a lower role could read through another role's mask.

**Behavior.** A middleware installed right after the request logger reads a JSON request body before the handler and the JSON response body after it, and keeps both under the request id when, and only when, an audit row was written under that id. Each body is parsed, redacted, serialised, and cut at 64 KiB; the row keeps `request_id` after the bodies are gone.

Redaction runs at write time, never at read time. A key holding `password`, `token`, `secret`, `passphrase`, `authorization` or `cookie` as a word, or containing `connection_string`, `private_key` or `access_key`, is replaced whole by `••••••••`, and so is everything under `secrets` and `readonly_secrets`. `username`, `email`, `user`, `host` and `ip` keep their first three and last three characters (a value of six or fewer is all asterisks). A body that is not JSON is never kept: nothing could have redacted it, so a note takes its place. `POST /auth/password` and `POST /users/{id}/reset-password` keep no request body at all, since `current` and `next` are both credentials. A body above 1 MiB is not read; a note gives its size. A `204` has no response body.

**Output.** `200` `{ state, method, path, status, request, response, request_truncated, response_truncated }`. `state` is `kept`, `expired` (the row has a request id but its bodies passed `retention.audit_payload_days`, 16 §16.1) or `none` (a job's or the system's row). A body cut at the cap arrives as the text that was kept, a JSON string rather than the object it was. **Errors.** `NOT_FOUND` when the row is not there or outside the caller's scope. **Traceability.** Story 108.
