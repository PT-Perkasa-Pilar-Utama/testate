# 4. Projects

Module: `projects` ([../technical-specs/05-module-definitions.md §5.4](../technical-specs/05-module-definitions.md)). Data: [../technical-specs/06-data-model.md §6.4](../technical-specs/06-data-model.md). Deletion recipe: [../technical-specs/13-checkout-and-restore.md §13.7](../technical-specs/13-checkout-and-restore.md).

Project object:

```json
{ "id": "01J...", "slug": "shop", "name": "Shop", "description": null,
  "quota_bytes": 10737418240,
  "head": { "status": "at_state", "state_id": "01J...", "state_name": "seeded-baseline", "changed_at": "...", "dirty": false },
  "created_by": "01J...", "created_by_label": "Ada Lovelace", "created_at": "...", "updated_at": "..." }
```

`head.status` is `none`, `at_state`, or `unknown` ([06 §6.9](../technical-specs/06-data-model.md)). `head.dirty` is true once the live databases are known to differ from what HEAD names: a write session or an import wrote to them, or a diff of HEAD against live found rows that moved. A write from outside Testate stays invisible until such a diff runs. A checkout or a snapshot clears it. `created_by_label` is the creator's display name, so a list can say who without a second request.

## 4.1 `GET /projects`

**Purpose.** List projects in scope. **Access.** `viewer`. **Input.** Query: `cursor`, `limit` (1 to 200, default 50), `sort` (`name`, `created_at`, `updated_at`, `changed_at`), `order`, `q`, `created_from`, `created_to`. **Behavior.** Project-scoped tokens see only their projects. `q` matches a project's `slug` or `name`. `sort: changed_at` orders by `head.changed_at`, the one field a level down from the rest. `created_from`/`created_to` bound `created_at`. **Output.** `200` list. **Traceability.** Stories 11, 12.

## 4.2 `POST /projects`

**Purpose.** Create a project. **Access.** `qa`. **Input.** Body: `slug` string optional, `[a-z0-9-]{2,64}`; omit it and the API derives one from `name`, adding `-2`, `-3` until it is free, or send one and get exactly that slug or a `409`. `name` string required, 1 to 120. `description` string optional, at most 2000 characters. `quota_bytes` integer optional, `>= 0`, or `null`; null or absent inherits `quota.default_bytes`, `0` means no quota at all. **Behavior.** Unique slug; audit `project.created`. **Output.** `201` project. **Errors.** `CONFLICT` (slug taken), `VALIDATION_ERROR`. **Traceability.** Story 10.

## 4.3 `GET /projects/{slug}`

**Purpose.** Overview for the project page. **Access.** `viewer`.

**Output.** `200`

```json
{ "data": { "project": { "...": "project object" },
            "adapters": [ { "id": "01J...", "name": "orders-db", "kind": "database", "engine": "postgres", "tier": "tabular", "mode": "sandbox", "status": "ok" } ],
            "latest_jobs": [ { "...": "job objects, newest 10" } ],
            "quota": { "used_bytes": 3221225472, "quota_bytes": 10737418240, "instance_used_bytes": 9663676416, "instance_ceiling_bytes": null },
            "banner": null } }
```

`banner` carries `{ "kind": "head_unknown", "message": "..." }` after an interrupted or partial checkout (story 107).

**Errors.** `NOT_FOUND`. **Traceability.** Story 12.

## 4.4 `PATCH /projects/{slug}`

**Purpose.** Rename, describe, or set the quota. **Access.** `qa` for name and description; `admin` for `quota_bytes`. **Input.** Body: `name`? (1 to 120); `description`? (at most 2000 characters, or `null`); `quota_bytes`? (integer `>= 0`, or `null` = default). **Behavior.** Audit `project.updated`. **Output.** `200` project. **Errors.** `FORBIDDEN` (quota by qa), `NOT_FOUND`, `VALIDATION_ERROR`. **Traceability.** Story 16.

## 4.5 `GET /projects/{slug}/head`

**Purpose.** HEAD for CI scripts. **Access.** `viewer`. **Output.** `200 { "data": { "status": "at_state", "state_id": "...", "state_name": "...", "changed_at": "...", "dirty": false } }`. **Traceability.** Stories 12, 113.

## 4.6 `GET /projects/{slug}/quota`

**Purpose.** Storage usage for the project and the instance, for the settings page and CI guards. **Access.** `viewer`. **Output.** `200 { "data": { "used_bytes": 3221225472, "quota_bytes": 10737418240, "warn_at_bytes": 8589934592, "instance_used_bytes": 9663676416, "instance_ceiling_bytes": null } }`. `warn_at_bytes` is eighty percent of the quota ([15 §15.1](../technical-specs/15-snapshot-store.md)). **Errors.** `NOT_FOUND`. **Traceability.** Story 16.

## 4.7 `GET /projects/{slug}/deletion-plan`

**Purpose.** What a project delete will do to each database adapter before the admin confirms.

**Access.** `admin`.

**Behavior.** For each adapter: a database adapter not in `read_only` mode gets action `restore`; a `read_only` database adapter gets `skip` with `reason: "read_only"`; a storage adapter gets `none` (story 14). There is no reachability probe and no fingerprint comparison today: `init_state_id` and `drift` are always `null`, and `force` and the other listed reasons (`unreachable`, `no_init_state`, `removed`) are never produced, though the schema still allows them. `affected` counts the rows the delete takes with the project, so the dialog can name them before it accepts the slug: the restore is not stashed, and every state goes with the project.

**Output.** `200`

```json
{ "data": { "plan_id": "01J...", "expires_at": "...", "protected_states": 3,
            "affected": { "adapters": 2, "states": 12, "protected_states": 3, "checkouts": 5,
                          "diffs": 1, "import_runs": 4, "saved_queries": 2, "tokens": 1 },
            "adapters": [
              { "adapter_id": "01J...", "name": "orders-db", "engine": "postgres", "init_state_id": null, "action": "restore", "drift": null },
              { "adapter_id": "01J...", "name": "legacy-db", "engine": "mysql", "init_state_id": null, "action": "skip", "reason": "read_only", "drift": null },
              { "adapter_id": "01J...", "name": "exports", "engine": "s3", "init_state_id": null, "action": "none", "drift": null } ] } }
```

**Errors.** `NOT_FOUND`. **Traceability.** Stories 13, 14.

## 4.8 `POST /projects/{slug}/deletion`

**Purpose.** Return every database to init, then delete the project.

**Access.** `admin`.

**Input.** Body: `confirm_slug` string required, must equal the slug; `plan_id` string required, from 4.7, unexpired; `adapters` array required: `[{ "adapter_id", "action": "restore" | "force" | "skip" }]` covering every database adapter in the plan.

**Behavior.**
1. Validate the slug, the plan id, and that every action is allowed by the plan (`CONFLICT` otherwise): a `restore`-planned adapter accepts `restore` or `skip`; a `skip`- or `none`-planned adapter accepts only `skip`. Because the plan never reports drift today (04 §4.7), `force` is never an allowed action — sending it always answers `CONFLICT`.
2. Enqueue job kind `project_delete` claiming every adapter (`JOB_IN_PROGRESS` if any is busy).
3. The job runs `returnToInit` for every `restore` (and, were it ever chosen, `force`) adapter (no stash); a `skip` adapter is left as it is. It records per-adapter results, and removes tokens scoped to the project, normalizers, states, adapters, and the project only after every non-skipped adapter reports `restored`. A failure leaves everything, sets HEAD unknown, and the job fails so the plan can be retried (story 15). Audit `project.deleted` with per-adapter results (stories 13, 108, 109).

**Output.** `202` job, `Location`. **Errors.** `CONFLICT`, `JOB_IN_PROGRESS`, `NOT_FOUND`, `VALIDATION_ERROR`. **Traceability.** Stories 13, 14, 15, 109.

## 4.9 `GET /projects/defaults`

**Purpose.** What a new project inherits, for the "New project" dialog's quota default. Routed before `/projects/{slug}`; `defaults` is reserved in the slug-generation logic, so no project can ever answer here.

**Access.** `qa`.

**Output.** `200 { "data": { "quota_bytes": 10737418240 } }` — the instance's `quota.default_bytes` setting. **Traceability.** Story 10.
