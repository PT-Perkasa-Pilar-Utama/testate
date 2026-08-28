# 13. Hooks

Module: `hooks` ([../technical-specs/05-module-definitions.md §5.13](../technical-specs/05-module-definitions.md)). Paths under `/projects/{slug}`.

Hook object:

```json
{ "id": "01J...", "trigger": "after_checkout", "request": { "id": "01J...", "adapter_id": "01J...", "name": "clear-cache" },
  "position": 1, "enabled": true, "fail_policy": "continue", "created_at": "...", "updated_at": "..." }
```

Triggers: `before_checkout`, `after_checkout`, `after_snapshot`, `after_import`.

## 13.1 `GET .../hooks`

**Access.** `viewer`. **Input.** Query: `trigger`. **Output.** `200` list ordered by trigger then position. **Traceability.** Story 101.

## 13.2 `POST .../hooks`

**Purpose.** Bind a saved request to a trigger (story 101). **Access.** `qa`. **Input.** Body: `trigger` required; `rest_request_id` required (a request of a REST adapter in the project); `fail_policy` `abort` | `continue`, default `continue`; `enabled` default true. **Behavior.** Appended at the end of the trigger's order. **Output.** `201` hook. **Errors.** `NOT_FOUND` (request), `VALIDATION_ERROR`. **Traceability.** Stories 101, 102.

## 13.3 `PATCH .../hooks/{id}` and `DELETE .../hooks/{id}`

**Access.** `qa`. **Input.** `enabled`?, `fail_policy`?, `rest_request_id`?. **Output.** `200` hook; `204`. **Errors.** `NOT_FOUND`. **Traceability.** Story 102.

## 13.4 `PUT .../hooks/order`

**Purpose.** Reorder within a trigger. **Access.** `qa`. **Input.** Body: `trigger` required; `hook_ids` required, the complete ordered list for that trigger. **Output.** `200` list. **Errors.** `VALIDATION_ERROR` (missing or foreign ids). **Traceability.** Story 101.

## 13.5 Hook runs

Hook runs are not a separate resource: a job's `result.hooks[]` lists `{ hook_id, trigger, request_run_id, status, status_code, duration_ms, policy }`, and each run is readable through 12.3. A `before_checkout` hook with `abort` that fails ends the job before any restore (story 102).
