# 16. Settings, Store Migration, Backup

Module: `settings` ([../technical-specs/05-module-definitions.md §5.16](../technical-specs/05-module-definitions.md)). Keys and defaults: [06 §6.8](../technical-specs/06-data-model.md). Precedence over environment: [11 §11.2](../technical-specs/11-environment-configuration.md).

## 16.1 `GET /settings`

**Access.** `admin`.

**Output.** `200`

```json
{ "data": {
  "store": { "driver": "local", "s3": null, "locked_by_env": false },
  "retention": { "stash_keep": 5, "diff_days": 7, "query_history_days": 90, "job_history_days": 90, "audit_days": 365, "import_run_days": 30 },
  "quota": { "default_bytes": 10737418240, "instance_ceiling_bytes": null },
  "limits": { "query_rows_default": 500, "query_rows_max": 5000, "query_bytes": 10485760, "query_timeout_ms": 30000, "query_timeout_max_ms": 300000, "upload_mb": 50, "token_requests_per_minute": 600, "agent_requests_per_minute": 120, "write_session_idle_minutes": 30, "job_concurrency": 2 },
  "netguard": { "deny": ["127.0.0.0/8", "::1/128"], "fixed": ["169.254.0.0/16", "fe80::/10", "169.254.169.254", "fd00:ec2::254", "metadata.google.internal", "self"] },
  "log": { "sample_rate_by_route": {} },
  "locked_by_env": ["limits.upload_mb", "limits.job_concurrency"] } }
```

S3 secrets appear as sealed fields. **Traceability.** Stories 118, 120.

## 16.2 `PATCH /settings`

**Purpose.** Update any editable key. **Access.** `admin`. **Input.** Body: a partial of the object above; S3 secrets as values or `"keep"`. **Behavior.** Keys in `locked_by_env` answer `CONFLICT`; a change to `netguard.deny` re-checks every adapter and REST target and disables matches (story 33), audited as `settings.deny_list_changed` with the disabled ids; the store driver cannot be changed here (16.3). Audit `settings.updated`. **Output.** `200` settings plus `{ "disabled_adapters": [...] }` when the deny list changed. **Errors.** `CONFLICT`, `VALIDATION_ERROR`. **Traceability.** Stories 32, 33, 120.

## 16.3 `POST /settings/store-migration`

**Purpose.** Move every referenced blob to a new store and switch (story 119). **Access.** `admin`. **Input.** Body: `target` `{ "driver": "s3", "s3": { "bucket", "prefix", "region", "endpoint"?, "virtual_hosted", "access_key_id", "secret_access_key" } }` or `{ "driver": "local" }`. **Behavior.** Refused while any job runs (`JOB_IN_PROGRESS`) or when the store is locked by the environment (`CONFLICT`); address check on the endpoint; enqueue job `storage_migration` per [15 §15.7](../technical-specs/15-snapshot-store.md). **Output.** `202` job. **Errors.** `JOB_IN_PROGRESS`, `CONFLICT`, `HOST_BLOCKED`, `VALIDATION_ERROR`. **Traceability.** Story 119.

## 16.4 `POST /settings/backup`

**Purpose.** Back up metadata and, optionally, every blob (story 121). **Access.** `admin`. **Input.** Body: `include_blobs` boolean default false; `destination` `download` | `store` default `download`. **Behavior.** Enqueue job `backup` per [22 §22.5](../technical-specs/22-base-path-and-boot.md); a `download` destination keeps the tar under `run/backups/<job>.tar` for 24 hours. Audit `backup.created`. **Output.** `202` job; `result` carries `{ "size_bytes", "key_fingerprints": [...], "download_available_until" | "store_key" }`. **Errors.** `JOB_IN_PROGRESS` (another backup or migration running). **Traceability.** Stories 121, 128.

## 16.5 `GET /settings/backups/{job_id}`

**Purpose.** Download a finished backup. **Access.** `admin`. **Output.** `200 application/x-tar`, attachment. **Errors.** `NOT_FOUND` (expired or store destination), `CONFLICT` (job not finished). **Traceability.** Story 121.
