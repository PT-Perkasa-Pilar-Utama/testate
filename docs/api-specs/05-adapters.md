# 5. Adapters

Module: `adapters` ([../technical-specs/05-module-definitions.md §5.5](../technical-specs/05-module-definitions.md)). Data: [06 §6.4](../technical-specs/06-data-model.md). Probe and tiers: [12 §12.2](../technical-specs/12-engine-port.md). Address policy: [18](../technical-specs/18-outbound-address-policy.md).

Adapter object (secrets never included):

```json
{ "id": "01J...", "project_id": "01J...", "kind": "database", "engine": "postgres", "tier": "tabular",
  "name": "orders-db", "mode": "sandbox", "status": "ok", "status_message": null,
  "config": { "host": "pg.sit.internal", "port": 5432, "database": "shop", "user": "testate", "ssl": "prefer", "schemas": ["public"] },
  "credential": { "set": true, "set_at": "...", "key_fingerprint": "9f3c..." },
  "readonly_credential": { "set": false },
  "excluded_tables": ["public.schema_migrations"], "restore_mode": "atomic", "lock_timeout_ms": 60000,
  "engine_version": "16.3", "dialect": "postgres",
  "capabilities": { "canTruncate": true, "canDisableTriggers": false, "canTerminateSessions": true, "supportsDeferrableConstraints": false, "transactionalRestore": true, "snapshotRead": "repeatable-read", "timeSeriesDeletes": false },
  "strategy": { "emptyMode": "truncate", "foreignKeyHandling": "dependency-order", "transactional": true, "triggerDisable": false, "locking": "table" },
  "read_only_enforcement": "transaction", "last_probe_at": "...", "created_at": "...", "updated_at": "..." }
```

`config` fields by kind: database `{ host, port, database, user, ssl, schemas? }` or `{ connection_string_set: true }`; storage s3 `{ bucket, prefix, region, endpoint?, virtual_hosted }` (`s3` is any store that speaks S3: `endpoint` empty means Amazon, filled means R2, Google Cloud Storage over its interoperability API, Backblaze B2, MinIO or anything else, and `virtual_hosted` is on only for Amazon, who stopped accepting path style for buckets made after September 2020), sftp and ftp `{ host, port, user, root_path, tls? }`.

Draft body (create, test, update):

| field | type | required | notes |
| --- | --- | --- | --- |
| `kind` | `database` \| `storage` | create | immutable after create |
| `engine` | `postgres` \| `mysql` \| `mariadb` \| `mongodb` \| `s3` \| `sftp` \| `ftp` | create | immutable |
| `name` | string | create | unique per project, case-insensitive |
| `mode` | `sandbox` \| `read_only` | no | database kind only; default `sandbox` |
| `config` | object | create | public fields per kind as above |
| `secrets` | object | create | sealed fields per kind: `password` or `connection_string`; `access_key_id` and `secret_access_key`; `password` or `private_key` (+ `passphrase`). On update each value is a new value or `"keep"` |
| `readonly_secrets` | object | no | database kind; same shape; `null` removes |
| `excluded_tables` | string[] | no | default from the engine's list |
| `restore_mode` | `atomic` \| `fast` | no | MySQL and MariaDB only |
| `lock_timeout_ms` | integer | no | 1 000 to 600 000, default 60 000 |

## 5.1 `GET /projects/{slug}/adapters`

**Access.** `viewer`. **Input.** Query: `kind`, `engine`, `status`. **Output.** `200` list of adapter objects. **Traceability.** Story 12.

## 5.2 `POST /projects/{slug}/adapters/test`

**Purpose.** Test a draft or a full draft body before saving (story 18).

**Access.** `qa`.

**Input.** Body: the draft body above, secrets in plain (never stored).

**Behavior.** Address check (`HOST_BLOCKED`); probe the engine or the file source; refuse below the floor (`ENGINE_UNSUPPORTED` with `details.floor`); return the probe result and warnings. Nothing is written; the wide event carries only host, engine, and outcome.

**Output.** `200`

```json
{ "data": { "engine": "postgres", "dialect": "postgres", "version": "16.3", "meets_floor": true, "floor": "13", "tier": "tabular",
            "capabilities": { "...": "..." }, "strategy": { "...": "..." }, "read_only_enforcement": "transaction",
            "table_count": 42, "size_estimate_bytes": 812345678,
            "atomicity_notice": "Postgres restores are one transaction; restored tables are locked for the duration.",
            "warnings": [] } }
```

**Errors.** `HOST_BLOCKED` 422, `ENGINE_UNSUPPORTED` 422, `ADAPTER_UNREACHABLE` 502 (auth failures included, `details.reason: "auth"`), `VALIDATION_ERROR`. **Traceability.** Stories 18, 19, 20, 32.

## 5.3 `POST /projects/{slug}/adapters`

**Purpose.** Create and seal an adapter; a database adapter gets its init state.

**Access.** `qa`.

**Input.** Draft body.

**Behavior.**
1. Address check, probe as in 5.2; store capabilities, strategy, version, dialect, tier, `target_hash`.
2. Seal `secrets` and `readonly_secrets` (story 34).
3. Storage kind is always `read_only`.
4. Database kind: enqueue job `snapshot` into the project's one protected state named `init`, creating it for the first adapter and adding an entry to it for every later one; a change of host, port, or database replaces that adapter's entry. Return-to-init resolves the adapter's entry in that state by the adapter's immutable id, so a rename changes nothing.
5. Audit `adapter.created`.

**Output.** `201 { "data": { "adapter": {...}, "init_job": { job } | null } }`. **Errors.** As 5.2 plus `CONFLICT` (name; a database while HEAD is not the starting point, or the databases moved since). **Traceability.** Stories 17, 21, 23, 24, 26, 27, 34, 93, 98.

## 5.4 `GET /projects/{slug}/adapters/{id}`

**Access.** `viewer`. **Output.** `200` adapter. **Errors.** `NOT_FOUND`.

## 5.5 `PATCH /projects/{slug}/adapters/{id}`

**Purpose.** Rename, change config or secrets, excluded tables, restore mode, lock timeout.

**Access.** `qa`.

**Input.** Any draft field except `kind`, `engine`, `mode`; secrets as new values or `"keep"`.

**Behavior.**
1. Address check and probe when host, port, database, or secrets change.
2. A change of host, port, or database (new `target_hash`) enqueues a new init state (story 28); a rename changes nothing else (story 29).
3. Credential replacement evicts the connection pool; audit `adapter.credential_replaced` (story 34); other changes audit `adapter.updated`.

**Output.** `200 { "data": { "adapter": {...}, "init_job": job | null } }`. **Errors.** As 5.2 plus `CONFLICT`, `NOT_FOUND`. **Traceability.** Stories 24, 26, 28, 29, 34.

## 5.6 `POST /projects/{slug}/adapters/{id}/mode`

**Purpose.** Tighten or loosen the mode.

**Access.** `qa` for `read_only`; `admin` for `sandbox` (story 22).

**Input.** Body: `mode` required.

**Behavior.** Loosening audits `adapter.mode_loosened`; tightening audits `adapter.mode_tightened`; tightening ends open write sessions on the adapter.

**Output.** `200` adapter. **Errors.** `FORBIDDEN` (qa loosening), `NOT_FOUND`, `VALIDATION_ERROR` (storage kind). **Traceability.** Stories 21, 22.

## 5.7 `POST /projects/{slug}/adapters/{id}/retest`

**Purpose.** Re-probe a saved adapter after a credential or privilege change (story 18). **Access.** `qa`. **Behavior.** As 5.2 with stored secrets; updates status, capabilities, strategy, version; a deny-list match sets status `disabled`. **Output.** `200` probe result. **Errors.** As 5.2, `NOT_FOUND`. **Traceability.** Stories 18, 19, 33.

## 5.8 `GET /projects/{slug}/adapters/{id}/deletion-plan`

**Purpose.** What deleting this adapter will do. **Access.** `qa`. **Behavior.** As 4.6 for one adapter; states referencing it are counted. **Output.** `200 { "data": { "plan_id", "expires_at", "adapter": { "action": "restore" | "force" | "skip", "reason"?, "drift"? }, "states_referencing": 12 } }`. **Errors.** `NOT_FOUND`, `JOB_IN_PROGRESS`. **Traceability.** Stories 14, 30.

## 5.9 `POST /projects/{slug}/adapters/{id}/deletion`

**Purpose.** Return the database to init, then delete the adapter.

**Access.** `qa`.

**Input.** Body: `plan_id` required; `action` required: `restore` | `force` | `skip`.

**Behavior.** Enqueue job `adapter_delete`; the job restores per the action (no stash), then marks the adapter removed in every manifest, deletes normalizers, saved queries, policies, and the adapter row only after the restore succeeded or was skipped (stories 30, 31). Audit `adapter.deleted` with the result.

**Output.** `202` job. **Errors.** `CONFLICT` (stale plan), `JOB_IN_PROGRESS`, `NOT_FOUND`. **Traceability.** Stories 30, 31.
