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

`project` and `adapter` keep slug and name as text after their subject is deleted (story 109). `target_label` is the target's name at the time of the event; it is `null` on rows written before the column existed.

## 15.1 `GET /audit-logs`

**Access.** `viewer` (scope-filtered by the token's project scope; every unscoped actor, whatever its role, also sees instance-level rows — there is no role check). **Input.** Query: `cursor`, `limit` (default 50, max 200), `project_id`, `q` (substring match over the actor label, the action, and the target's label or id), `actor` (substring match against the actor label only, not user or token ids), `action` (substring match), `from`, `to` (timestamps), `outcome`. **Output.** `200` list, newest first. **Traceability.** Stories 108, 110.

## 15.2 `GET /audit-logs/export`

**Purpose.** CSV of the filtered rows (story 110). **Access.** `viewer`. **Input.** Same filters as 15.1. **Behavior.** Walks every page the filter matches, using `limit` as the internal page size, and assembles the whole CSV in memory before responding. **Output.** `200 text/csv`, attachment, sent as a single response (not streamed). **Traceability.** Story 110.
