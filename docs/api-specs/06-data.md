# 6. Data: Schema, Rows, Queries, Editing, Policies, Fixtures

Module: `data` ([../technical-specs/05-module-definitions.md §5.6](../technical-specs/05-module-definitions.md)). Editing, policies, masks, fixtures: [24](../technical-specs/24-table-editing.md). Engine limits: [12 §12.1](../technical-specs/12-engine-port.md). All paths are under `/projects/{slug}/adapters/{id}` and apply to database adapters; a Files adapter answers `422 ENGINE_UNSUPPORTED`. Operations marked **Tabular** answer `422 ENGINE_UNSUPPORTED { "reason": "tier" }` on MongoDB.

Masks: responses to `viewer` users and agent tokens apply column masks; `masked_columns` lists the affected columns (stories 148, 138).

## 6.1 `GET .../schema`

**Purpose.** Introspection for the grid, forms, mappings, and drift display.

**Access.** `viewer`.

**Output.** `200`

```json
{ "data": { "tier": "tabular", "fingerprint": "sha256:9f3c...",
  "tables": [ { "schema": "public", "name": "orders", "kind": "table", "row_estimate": 120433,
      "columns": [ { "name": "id", "type": "bigint", "nullable": false, "has_default": true, "generated": false, "identity": true, "policy": { "required_function": null, "mask": null } } ],
      "primary_key": ["id"],
      "foreign_keys_out": [ { "columns": ["customer_id"], "ref": { "schema": "public", "name": "customers" }, "ref_columns": ["id"], "deferrable": false } ],
      "foreign_keys_in": [ { "from": { "schema": "public", "name": "order_items" }, "columns": ["order_id"] } ],
      "unique": [["order_number"]], "unsupported": [], "excluded": false, "display_column": "order_number" } ],
  "views": [ { "schema": "public", "name": "order_totals" } ],
  "warnings": [] } }
```

**Errors.** `ADAPTER_UNREACHABLE`, `NOT_FOUND`. **Traceability.** Stories 35, 140.

## 6.2 `GET .../tables/{table}/rows`

**Purpose.** Grid page. **Access.** `viewer`.

**Input.** Query: `cursor`, `limit` (default 100, max 500), `sort` (column), `order`, `filter` repeated as `filter=<column>:<op>:<value>` with ops `eq`, `ne`, `lt`, `le`, `gt`, `ge`, `like`, `in` (comma list), `null`, `notnull`.

**Behavior.** Keyset paging when the table has a primary key, offset paging otherwise (`page.kind`); read-only session; masks by role; FK columns carry `display` when a display column exists (story 140).

**Output.** `200 { "data": [ { "id": "88213", "status": "paid", "customer_id": 5120, "_display": { "customer_id": "Dina Putri" } } ], "page": { "next_cursor": "...", "limit": 100, "kind": "keyset" }, "columns": [...], "masked_columns": [] }`.

**Errors.** `VALIDATION_ERROR` (unknown column), `ADAPTER_UNREACHABLE`, `NOT_FOUND`. **Traceability.** Stories 36, 140.

## 6.3 `GET .../tables/{table}/export`

**Purpose.** The whole table as a downloadable file: the grid's Export CSV and Export JSON links, and the answer for a mapping or a tester who cannot write SQL.

**Access.** `viewer`.

**Input.** Query: the same `cursor`, `limit` (default 100, max 500), `sort`, `order`, and `filter` as 6.2, plus `format`: `csv` | `json`, default `csv`.

**Behavior.** Walks the table with the same keyset cursor 6.2 pages with, one `limit`-row page at a time, and keeps looping until the cursor is exhausted — nothing caps the row count, unlike 6.9's query export. Filters, sort, and column masks apply exactly as they do to a grid page. It is a `GET` so the browser follows a plain link and streams straight to disk; the session cookie carries the auth, the way a state archive download does.

**Output.** `200`, `Content-Type` `text/csv; charset=utf-8` or `application/json`, `Content-Disposition: attachment; filename="<table>.<format>"` (`public.orders` → `public-orders.csv`); a CSV header row followed by one line per row, or a single JSON array of row objects.

**Errors.** `VALIDATION_ERROR` (unknown column, bad filter), `ADAPTER_UNREACHABLE`, `NOT_FOUND`. **Traceability.** `docs/UI_REWORK.md` phase 3.

## 6.4 `GET .../tables/{table}/lookup` (Tabular)

**Purpose.** Candidates for an FK column in forms and the grid (story 142). **Access.** `viewer`. **Input.** Query: `column` required (an FK column of `{table}`), `q` string, `limit` (default 20, max 50). **Behavior.** Searches the referenced table by primary-key prefix and the display column. **Output.** `200 { "data": [ { "key": [5120], "display": "Dina Putri" } ] }`. **Errors.** `VALIDATION_ERROR` (not an FK column). **Traceability.** Story 142.

## 6.5 `POST .../write-sessions` (Tabular)

**Purpose.** Start a write session; required for row edits and write-mode queries. **Access.** `qa`; adapter `sandbox`.

**Input.** Body: `foreign_key_checks` boolean optional (default true).

**Behavior.** Refuse on `read_only` (`ADAPTER_READ_ONLY`); one open session per user per adapter; the first write in the session takes a stash (story 41); the session warns that policies do not cover raw SQL; audit `write_session.started`.

**Output.** `201 { "data": { "id": "01J...", "adapter_id": "...", "started_at": "...", "foreign_key_checks": true, "fk_checks_mapping": "SET FOREIGN_KEY_CHECKS = 0", "stash_state_id": null, "expires_at": "..." } }`.

**Errors.** `ADAPTER_READ_ONLY`, `CONFLICT` (session open), `NOT_FOUND`. **Traceability.** Stories 40, 41, 145.

## 6.6 `PATCH .../write-sessions/{sid}` and `DELETE .../write-sessions/{sid}`

**Purpose.** Toggle foreign-key checks; end the session. **Access.** `qa`, the session's owner. **Input.** `PATCH` body: `foreign_key_checks` boolean. **Behavior.** Off maps per [12 §12.3](../technical-specs/12-engine-port.md); refused with the reason when the engine cannot honor it (`ENGINE_UNSUPPORTED { "reason": "fk_toggle" }`); audit `write_session.fk_checks_off`. Delete ends the session; audit `write_session.ended`. **Output.** `200` session; `204`. **Errors.** `ENGINE_UNSUPPORTED`, `NOT_FOUND`. **Traceability.** Story 145.

## 6.7 `POST .../tables/{table}/row-edits` (Tabular)

**Purpose.** Insert, update, and delete rows in one transaction: bulk insert forms, inline edits, deletes (stories 42, 141, 143, 144).

**Access.** `qa`; open write session (`write_session_id`).

**Input.** Body:

| field | type | required | notes |
| --- | --- | --- | --- |
| `write_session_id` | string | yes | |
| `edits` | array, 1 to 50 | yes | items below |
| `edits[].kind` | `insert` \| `update` \| `delete` | yes | |
| `edits[].pk` | object | update, delete | primary-key columns and values |
| `edits[].values` | object | insert, update | column → `FormValue` |

`FormValue`: `{ "kind": "value", "value": ... }`, `{ "kind": "null" }`, `{ "kind": "default" }`, or `{ "kind": "function", "name": "now" | "uuid_v4" | "uuid_v7" | "random_hex" | "random_base64" | "hash_bcrypt" | "hash_argon2id" | "hash_sha256" | "hash_sha512" | "hmac_sha256", "input"?: string, "params"?: { "bytes"?: number, "cost"?: number, "secret"?: string } }`.

**Behavior.**
1. Session valid, adapter `sandbox`, table has a primary key for update and delete (`CONFLICT` otherwise).
2. Policy check: every policed column present in an insert or update must carry its required function (`VALIDATION_ERROR` naming column and function) (story 146).
3. Take the stash if this is the session's first write.
4. Run functions server-side; execute all edits in one transaction with the session's FK setting; roll back on any failure and report the failing edit index.
5. No audit row per call; the session's audit row carries `write_count` and the FK setting.

**Output.** `200 { "data": { "results": [ { "index": 0, "kind": "insert", "pk": { "id": "88214" }, "row": {...} } ], "stash_state_id": "01J..." } }`.

**Errors.** `VALIDATION_ERROR` (policy, shape), `CONFLICT` (no primary key, session closed), `ADAPTER_READ_ONLY`, `ADAPTER_UNREACHABLE` (`details.failed_index`, `details.engine_message`). **Traceability.** Stories 42, 141, 143, 144, 146.

## 6.8 `POST .../query`

**Purpose.** Run a read-only or write-mode query.

**Access.** `viewer` for `mode: read`; `qa` with a write session for `mode: write`.

**Input.** Body:

| field | type | required | notes |
| --- | --- | --- | --- |
| `dialect` | `sql` \| `mongo` | yes | `mongo` on MongoDB adapters only |
| `text` | string | sql | statement text |
| `params` | array | no | positional bind parameters (sql) |
| `mongo` | object | mongo | `{ "op": "find" \| "aggregate", "collection", "filter"?, "projection"?, "sort"?, "limit"?, "skip"?, "pipeline"? }` |
| `mode` | `read` \| `write` | no | default `read`; `write` requires `write_session_id` and is `sql` only |
| `write_session_id` | string | write | |
| `row_cap` | integer | no | default `limits.query_rows_default`, max `limits.query_rows_max` |
| `byte_budget` | integer | no | default from settings |
| `time_budget_ms` | integer | no | default 30 000, max `limits.query_timeout_max_ms` |
| `tag` | string | no | shown in running queries |

**Behavior.** Read mode runs in a read-only transaction (SQL) or with the read credential or filter (MongoDB, `read_only_enforcement` in the response) (stories 37, 38, 39); write mode takes the stash on the session's first write; the row cap wraps the statement; history row written with the text; masks by role; the wide event carries the hash and byte count only.

**Output.** `200 { "data": { "query_id": "01J...", "columns": [ { "name": "id", "type": "bigint" } ], "rows": [...], "rows_affected": null, "truncated": { "rows": false, "bytes": false, "time": false }, "duration_ms": 41, "read_only_enforcement": "transaction", "masked_columns": [] } }`.

**Errors.** `VALIDATION_ERROR`, `FORBIDDEN` (write without session, viewer write), `ADAPTER_READ_ONLY`, `RATE_LIMITED`, `ADAPTER_UNREACHABLE` (`details.engine_message` for syntax errors, `details.cancelled: true`). **Traceability.** Stories 37, 38, 39, 40, 43, 44.

## 6.9 `POST .../query/export`

**Purpose.** The same query streamed as a file. **Access.** As 6.8, read mode only. **Input.** 6.8 body plus `format`: `csv` | `json`. **Output.** `200` stream, `Content-Disposition: attachment; filename="<adapter>-<timestamp>.csv"`; masks apply. **Traceability.** Story 47.

## 6.10 `GET .../queries` and `DELETE .../queries/{query_id}`

**Purpose.** Running queries and cancel. **Access.** `viewer` lists own and others' queries with tags; cancel is the query's owner or `admin`. **Behavior.** Cancel issues the engine's cancel from a second connection; the running query fails with `details.cancelled: true`. **Output.** `200 { "data": [ { "query_id", "tag", "actor", "mode", "started_at", "duration_ms" } ] }`; `204`. **Errors.** `NOT_FOUND`, `FORBIDDEN`. **Traceability.** Story 48.

## 6.11 Saved queries

`GET .../saved-queries`, `POST .../saved-queries` (body `name`, `body` = a 6.8 body without limits), `PATCH .../saved-queries/{qid}`, `DELETE .../saved-queries/{qid}`. **Access.** `viewer` reads; `qa` writes. Names unique per adapter. **Errors.** `CONFLICT`, `NOT_FOUND`. **Traceability.** Story 45.

## 6.12 `GET .../query-history`

**Purpose.** The caller's history. **Access.** `viewer` (own rows); `admin` sees all with `user_id`. **Input.** Query: `cursor`, `limit`, `mode`. **Output.** `200` list of `{ id, query_hash, query_text, mode, duration_ms, row_count, error, created_at }`. **Traceability.** Story 46.

## 6.13 Column policies (Tabular)

`GET .../policies` lists; `PUT .../policies/{table}/{column}` upserts `{ "required_function": { "name", "params" } | null, "mask": "redact" | "partial" | "hash" | null, "display": boolean }`; `DELETE .../policies/{table}/{column}` removes; `POST .../policies/{table}/{column}/lock` and `/unlock` (admin).

**Access.** `viewer` reads; `qa` writes unlocked policies; `admin` locks and edits locked ones.

**Behavior.** A locked policy answers `FORBIDDEN` to `qa` on `PUT` and `DELETE`; `display: true` on a column makes it the table's lookup display column (one per table); audit `policy.created`, `policy.updated`, `policy.removed`, `policy.locked`.

**Output.** `200` policy `{ "table", "column", "required_function", "mask", "display", "locked", "updated_at" }`; `204` on delete. **Errors.** `FORBIDDEN`, `NOT_FOUND` (column), `VALIDATION_ERROR`. **Traceability.** Stories 146, 147, 148.

## 6.14 `POST .../fixture`

**Purpose.** Extract a row and its related rows for local reproduction (stories 136, 150).

**Access.** `viewer` (masked); `qa` and `admin` raw.

**Input.** Body: `table` required; `pk` object required; `depth` integer 0 to 3, default 2; `direction` `parents` | `children` | `both`, default `parents`; `format` `sql` | `json`, default `sql`.

**Behavior.** Walk foreign keys per [24 §24.6](../technical-specs/24-table-editing.md); cap 500 rows; masks by role become typed placeholders; MongoDB returns the single document; audit `fixture.extracted`.

**Output.** `200 { "data": { "format": "sql", "content": "INSERT INTO public.customers ...;\n...", "rows": 7, "tables": ["public.customers", "public.orders"], "truncated": false, "masked_columns": ["public.customers.email"] } }`.

**Errors.** `NOT_FOUND` (row), `CONFLICT` (no primary key), `VALIDATION_ERROR`. **Traceability.** Stories 136, 150.
