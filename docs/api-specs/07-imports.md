# 7. Uploads and Imports

Module: `imports` ([../technical-specs/05-module-definitions.md §5.7](../technical-specs/05-module-definitions.md)). Pipeline: [19](../technical-specs/19-import-pipeline.md). Tabular adapters only; a MongoDB or Files adapter answers `422 ENGINE_UNSUPPORTED { "reason": "tier" }`.

## 7.1 `POST /projects/{slug}/uploads`

**Purpose.** Upload a file once and reference it by id in preview, dry run, run, and archive import.

**Access.** `qa`.

**Input.** `multipart/form-data` with one part `file` (name, size up to `TESTATE_MAX_UPLOAD_MB`); optional part `purpose` = `import` | `archive` (default `import`).

**Behavior.** Store under `uploads/<upload_id>/` with a random file name; record size, detected type (`csv`, `xlsx`, `tar`); expire after one hour or when a job consumes it.

**Output.** `201 { "data": { "upload_id": "01J...", "file_name": "customers.xlsx", "size_bytes": 812345, "type": "xlsx", "expires_at": "..." } }`.

**Errors.** `PAYLOAD_TOO_LARGE`, `VALIDATION_ERROR` (unsupported type). **Traceability.** Stories 49, 71.

## 7.2 `POST /projects/{slug}/imports/preview`

**Purpose.** Parse the first rows and detect columns, sheets, delimiter (story 49).

**Access.** `qa`.

**Input.** Body: `source` required: `{ "upload_id" }` or `{ "adapter_id", "path" }` (Files adapter, story 51); `options` optional: `sheet`, `header_row` (default 1), `delimiter`, `encoding`.

**Output.** `200 { "data": { "columns": ["Email", "Joined", "Password"], "rows": [ ["a@b.c", "2026-01-31", "..."] ], "sheets": ["Sheet1"], "detected": { "delimiter": ",", "encoding": "utf-8", "header_row": 1 }, "typed_cells": true } }`.

**Errors.** `NOT_FOUND` (upload expired, file missing), `VALIDATION_ERROR`, `ADAPTER_UNREACHABLE`. **Traceability.** Stories 49, 50, 51.

## 7.3 Mappings

`GET /projects/{slug}/adapters/{id}/mappings`, `POST` (body: `name`, `target` table, `columns[]`, `key_columns[]`, `mode`, `options`), `GET .../mappings/{mid}`, `PATCH`, `DELETE`. Mapping JSON per [19 §19.2](../technical-specs/19-import-pipeline.md).

**Access.** `viewer` reads; `qa` writes.

**Behavior.** `POST` and `PATCH` validate the mapping against the live schema: target exists, target columns exist, `key_columns` present for `upsert`, every policed target column carries its required transform (`VALIDATION_ERROR` naming column and function, story 146). Names unique per adapter.

**Errors.** `CONFLICT`, `NOT_FOUND`, `VALIDATION_ERROR`, `ENGINE_UNSUPPORTED` (tier). **Traceability.** Stories 52, 53, 54.

## 7.4 `POST /projects/{slug}/imports`

**Purpose.** Dry run or real import through a mapping.

**Access.** `qa`; real run needs a `sandbox` adapter.

**Input.** Body:

| field | type | required | notes |
| --- | --- | --- | --- |
| `adapter_id` | string | yes | Tabular |
| `mapping_id` | string | yes | |
| `source` | object | yes | `{ "upload_id" }` or `{ "adapter_id", "path" }` or `{ "rejected_of_run_id" }` (re-import rejected rows, story 59) |
| `mode` | `append` \| `upsert` \| `replace` | no | default: the mapping's mode |
| `dry_run` | boolean | no | default false |
| `stash_first` | boolean | no | default: true for `replace`, false otherwise |
| `foreign_key_checks` | boolean | no | default true |
| `options` | object | no | overrides sheet, header row, delimiter |

**Behavior.** Enqueue job `import` claiming the adapter (`JOB_IN_PROGRESS`); the job follows [19 §19.3](../technical-specs/19-import-pipeline.md): stash when required (story 57), policy check, parse, transforms, validation (story 56), batches with the FK setting (story 145), report, rejected rows file (story 58). Audit `import.run`.

**Output.** `202` job; the job's `result` is the report `{ "run_id", "dry_run", "inserted", "updated", "skipped", "failed", "duration_ms", "errors_preview": [ { "row_number": 12, "reason": "joined_at: not a date" } ], "rejected_available": true, "stash_state_id": "01J..." }`.

**Errors.** `ADAPTER_READ_ONLY` (real run on read-only), `JOB_IN_PROGRESS`, `NOT_FOUND`, `VALIDATION_ERROR`, `ENGINE_UNSUPPORTED`. **Traceability.** Stories 55, 56, 57, 58, 59, 145.

## 7.5 `GET /projects/{slug}/imports`

**Purpose.** Past runs. **Access.** `viewer`. **Input.** Query: `cursor`, `limit`, `adapter_id`, `dry_run`. **Output.** `200` list of `{ id, adapter_id, mapping_id, job_id, source, dry_run, mode, stash_state_id, counts, rejected_available, actor, created_at, finished_at }`. **Traceability.** Story 60.

## 7.6 `GET /projects/{slug}/imports/{run_id}` and `GET .../imports/{run_id}/rejected`

**Purpose.** One run's report; the rejected-rows CSV (original columns plus `row_number` and `reason`). **Access.** `viewer`. **Output.** `200` report; `200` CSV stream. **Errors.** `NOT_FOUND` (run, or file swept by retention). **Traceability.** Stories 58, 59.

## 7.7 `GET /projects/{slug}/adapters/{id}/tables/{table}/sample`

**Purpose.** A sample file generated from the schema or a mapping (story 149).

**Access.** `viewer`.

**Input.** Query: `format` required `csv` | `xlsx`; `mapping_id` optional (source column names from the mapping instead of table columns).

**Behavior.** Per [19 §19.4](../technical-specs/19-import-pipeline.md): header row, one typed example row, schema block; required columns marked; no real data.

**Output.** `200` file stream, `Content-Disposition: attachment; filename="sample-<table>.csv"`. **Errors.** `NOT_FOUND`, `ENGINE_UNSUPPORTED`. **Traceability.** Story 149.
