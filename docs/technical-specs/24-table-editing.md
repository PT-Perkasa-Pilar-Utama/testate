# 24. Table Editing, Policies, and Fixtures

The Tabular tier edits data the way phpMyAdmin does, with the guard rails Testate adds: typed insert and edit forms with a per-column function, foreign-key lookups, bulk insert, a foreign-key-checks toggle, column input policies that force hashing where a raw value must never land, masks for viewers and agents, the tools menu, and fixture extraction. This document is the single source for those; cite it.

## 24.1 Decision matrix

| Concern | Decision | Rationale |
| --- | --- | --- |
| Tier | Editing, policies' required functions, and import apply to Tabular adapters; masks and fixtures apply to Tabular and Document | Owner decision |
| Relations | The table view lists foreign keys in and out; an FK cell links to the referenced row; the grid shows a display value next to the key when a display column is configured | phpMyAdmin relation view |
| Insert and edit forms | One field per column, typed by canonical type; `NULL` and `default` checkboxes; a function dropdown; FK lookup with search; bulk insert of up to 50 rows in one form; "insert and add another" | phpMyAdmin insert page |
| Functions | `now`, `uuid_v4`, `uuid_v7`, `random_hex{bytes}`, `random_base64{bytes}`, `hash_bcrypt{cost}`, `hash_argon2id`, `hash_sha256`, `hash_sha512`, `hmac_sha256{secret}` applied server-side before the write | A password never lands raw |
| Policies | `column_policies` per adapter, table, column: `required_function`, `mask`, `display` (use as the lookup display column) | Owner request |
| Enforcement | Forms, grid edits, and import mappings refuse a policed column without its function (`VALIDATION_ERROR` naming the column and the function); raw SQL in a write session is not inspected | Structural where possible; the stash covers raw SQL |
| Masks | `redact` (`***`), `partial` (last four characters), `hash` (first eight hex of SHA-256); applied to `viewer` users and all agent access in grid, query results, diff rows, fixtures, and exports; `qa` and `admin` see raw | Owner request; 23 |
| FK checks toggle | Per write session and per import run, default on; off maps per 12 §12.3; refused with the reason when the engine cannot honor it | phpMyAdmin parity |
| Lookups | `GET .../tables/{table}/lookup?column=<fk column>&q=<text>&limit=20` searches the referenced table by primary key prefix and by the display column | Story 33 grid, forms |
| Tools menu | Stateless endpoints: hash (argon2id, bcrypt, sha256, sha512, hmac with secret, optional salt), random secret (bytes to hex, base64, base64url), UUID v4 and v7 with count | Owner request |
| Fixture extraction | Row plus FK parents to depth N (default 2, max 3), optionally children with a 500-row cap, as SQL `INSERT`s in dependency order or JSON; masks apply for viewer and agent | Owner request: reproduce locally |

## 24.2 Interface

```ts
// data module additions
lookup(actor, adapterId, table, column, q, limit): Promise<{ rows: Array<{ key: JsonScalar[]; display: string }> }>;
insertRows(actor, adapterId, table, rows: FormRow[], opts: { foreignKeyChecks?: boolean }, event): Promise<{ inserted: number; rows: DisplayRow[] }>;   // up to 50
updateRow(actor, adapterId, table, pk, row: FormRow, event): Promise<DisplayRow>;
deleteRow(actor, adapterId, table, pk, event): Promise<void>;
setWriteSessionOptions(actor, sessionId, { foreignKeyChecks }): Promise<WriteSession>;
policies: { list(adapterId, table?); upsert(actor, adapterId, policy); remove(actor, adapterId, table, column) };
extractFixture(actor, adapterId, { table; pk; depth?; direction?: "parents" | "children" | "both"; format: "sql" | "json" }, event): Promise<Fixture>;

type FormRow = Record<string, FormValue>;
type FormValue =
  | { kind: "value"; value: JsonScalar | object }
  | { kind: "null" } | { kind: "default" }
  | { kind: "function"; name: FunctionName; input?: string; params?: Record<string, JsonScalar> };

// tools module
hash(input: { algorithm: "argon2id" | "bcrypt" | "sha256" | "sha512" | "hmac_sha256"; value: string; secret?: string; salt?: string; cost?: number }): Promise<{ hash: string }>;
random(input: { bytes: 16 | 32 | 64 | number; encoding: "hex" | "base64" | "base64url" }): { value: string };
uuid(input: { version: 4 | 7; count?: number }): { values: string[] };
```

Column policy row:

```json
{ "adapter_id": "01J...", "table": "public.users", "column": "password_hash",
  "required_function": { "name": "hash_bcrypt", "params": { "cost": 12 } },
  "mask": "redact", "display": false }
```

## 24.3 Form field types

| Canonical type | Input | Notes |
| --- | --- | --- |
| text, varchar | text or textarea over 120 characters | trim optional |
| integer, bigint | number input with string precision | bigint kept as text |
| numeric, decimal | text with numeric validation | precision preserved |
| boolean | switch | |
| date, time, timestamp, timestamptz | native date and time inputs, timezone shown for timestamptz | ISO in the payload |
| enum | select | values from introspection |
| json, jsonb | JSON editor with validation | |
| uuid | text with format check, `uuid_v7` function suggested | |
| bytea, blob | hex or base64 text, file upload up to 1 MiB | |
| FK column | lookup field: search, pick, or type the key | display column when configured |
| policed column | function fixed to the policy; input is the plain value the function consumes | `hash_bcrypt` shows a password field |

## 24.4 Policies and masks

Policies are per adapter, keyed by `schema.table.column`. Defaults ship for common names: columns named `password`, `password_hash`, `passwd`, `secret`, `api_key`, `token` get `mask: redact` and `required_function: hash_bcrypt` suggested (not enforced until a `qa` user confirms the suggestion in the table's policy panel). A `qa` user manages policies; `admin` can lock a policy so `qa` cannot remove it.

Masks apply on the way out of the `data`, `diffs`, and `agent` modules by role: `viewer` and `agent` see masked values; `qa` and `admin` see raw. Exports and fixtures apply the same rule. A masked value in a fixture becomes a placeholder of the same type (`'***'`, `0`, or `NULL`), never the real value.

Required functions apply on the way in through forms, grid edits, and import mappings. A write-mode SQL statement is not parsed for policy; the write session's stash is the safety net, and the session start warns that policies do not cover raw SQL.

## 24.5 Foreign-key checks toggle

| Engine | Off means | Refused when |
| --- | --- | --- |
| MySQL, MariaDB | `SET SESSION FOREIGN_KEY_CHECKS = 0` for the session | never |
| Postgres | `SET CONSTRAINTS ALL DEFERRED` for the transaction when every FK involved is deferrable; else `SET LOCAL session_replication_role = replica` when the probe allows | neither is available; the message names the non-deferrable constraints or the missing privilege |

The toggle shows the mapping it will use before it is switched. Every write in a session with the toggle off is audited with `foreign_key_checks: false`.

## 24.6 Fixture extraction

```text
extract(table T, pk K, depth D, direction):
  visited = {}; queue = [(T, K, 0)]
  while queue: (t, k, d) = pop
    row = get(t, k) (masked per role); visited[t][k] = row
    if direction includes parents and d < D:
      for each FK out of t: enqueue (ref table, row[fk columns], d + 1) when not null
    if direction includes children and d < D:
      for each FK into t: enqueue up to remaining cap rows where ref columns = k
  order tables by dependency (parents first); within a table by key
  format sql: quoted identifiers and literals in the engine's dialect, one INSERT per row, bytea as hex, json as string, timestamps ISO with zone
  format json: { adapter, engine, extracted_at, masked_columns, tables: [{ table, columns, rows }] }
```

Cap: 500 rows total; the result says `truncated: true` with the tables that hit the cap. MongoDB: the document by `_id` only, as canonical Extended JSON, masked; no relation walk.

## 24.7 Performance targets

| Path | Target | Source |
| --- | --- | --- |
| Lookup | under 300 ms with an index on the display column; falls back to primary-key prefix only when the display column has no index | Estimate |
| Bulk insert of 50 rows | under 1 s | One multi-row insert |
| Hash tools | argon2id and bcrypt under 200 ms at default cost; cost capped (bcrypt 14, argon2id memory 128 MiB) | Bun defaults |
| Fixture, 500 rows depth 3 | under 5 s | 23 §23.5 |

## 24.8 Security constraints

Editing needs `qa`, `sandbox`, and a write session; the first write stashes. Functions run server-side; `hmac_sha256` secrets are request inputs, never stored. Tools endpoints are stateless, rate-limited per actor, and never logged with inputs. Masks are computed server-side; the SPA never receives a raw masked value for a viewer. Lookups run in read-only mode and return keys and display values only.

## 24.9 Component and contract

`modules/data/{data.forms.ts, data.lookup.ts, data.policies.ts, data.fixture.ts}`, `modules/tools/{tools.router.ts, tools.handler.ts, tools.service.ts, tools.test.ts}`, table `column_policies` (06 gains: `id, adapter_id FK CASCADE, "table", "column", required_function JSON, mask, display, locked, created_by, created_at, updated_at`, unique on adapter, table, column). Locked: the `FormValue` shape, the function names, the mask kinds, the fixture formats.

## 24.10 What this does not do

- No DDL: no create table, no alter column.
- No policy enforcement on raw SQL.
- No editing on the Document tier; MongoDB is view, state, diff, extract.
- No client-side hashing; the browser sends the plain value over HTTPS and the server hashes.

## 24.11 Cross-references

| Concern | Source |
| --- | --- |
| Engine write path, FK toggle mapping | [12-engine-port.md](12-engine-port.md) §12.3 |
| Import transforms and policies | [19-import-pipeline.md](19-import-pipeline.md) |
| Agent access and masks | [23-agent-access.md](23-agent-access.md) |
| Write sessions and stash | 05 §5.6 |

## 24.12 Open follow-ups

| Item | Revisit when |
| --- | --- |
| Policy templates shared across adapters | Several projects use the same application schema |
| Reverse fixture: import a fixture into a sandbox | Developers want to seed a bug scenario back into SIT |
