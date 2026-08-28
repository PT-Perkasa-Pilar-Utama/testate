# 19. Import Pipeline

An import turns a CSV or XLSX file into rows in one table of a Tabular adapter through a saved mapping: preview, mapping, dry run, run with a mode, stash, report, rejected rows, retry. Sample files generated from the schema make the first file right. This document is the single source for the pipeline; cite it.

## 19.1 Decision matrix

| Concern | Decision | Rationale |
| --- | --- | --- |
| Tier | Tabular only (Postgres, MySQL, MariaDB); the Document tier has no import | Owner decision 2026-08-28 |
| Sources | Upload (limit `TESTATE_MAX_UPLOAD_MB`) or a file on a storage adapter | Story 46, 48 |
| Parsers | `csv-parse` streaming with delimiter detection (`,` `;` `\t` `|`), UTF-8 with BOM, quoted newlines; `exceljs` streaming reader with sheet and header-row selection, typed cells read as values (dates, numbers, booleans), formulas by cached result | Story 46, 47 |
| Mapping | Per adapter and target table: `columns[{ source, target, transforms[] }]`, `key_columns`, `mode`, `options{ delimiter, sheet, header_row, encoding }` | Story 49, 51 |
| Transforms | `trim`, `emptyToNull`, `number{ locale }`, `date{ format, timezone }`, `boolean{ trueValues, falseValues }`, `constant{ value }`, `uuid`, `now`, `json`, `hash{ algorithm, secret? }` (column policies may require it), `lowercase`, `uppercase` | Story 50; policies from 24 |
| Policies | A policed column (24 §24.4) refuses a mapping without its required transform; masks do not apply to imports | Password columns never land raw |
| Dry run | Every row through transforms and `validateImportRow` (type, nullability, key presence, JSON parse, policy); first 100 errors returned with row numbers; states that constraints and triggers are checked by the real run only | Story 53 |
| Modes | `append`: insert; `upsert`: insert or update by `key_columns` (`ON CONFLICT DO UPDATE`, `ON DUPLICATE KEY UPDATE`); `replace`: delete every row then insert, inside one transaction on the SQL engines | Story 52 |
| Stash | `replace` stashes first always; `append` and `upsert` when `stash_first` is set | Story 54 |
| Foreign key checks | Per run toggle, default on; off maps per 12 §12.3 | Owner request: phpMyAdmin parity |
| Batches | 1 000 rows or 4 MiB, whichever first; a batch failure is retried row by row inside the batch to attribute the failing row, then the run continues | Story 55 |
| Report | `inserted`, `updated`, `skipped`, `failed`, `duration_ms`, `rejected_path` | Story 55 |
| Rejected rows | `${TESTATE_DATA_DIR}/imports/<run>/rejected.csv`: the original source columns plus `row_number` and `reason`; re-importable with the same mapping; retention `retention.import_run_days` | Story 56; outside the blob store because its lifecycle is the run's |
| Sample file | `GET .../tables/{table}/sample?format=csv|xlsx&mapping=<id>`: header row (table columns, or the mapping's source columns), one example row, and a schema block | Owner request |
| Upload lifecycle | `${TESTATE_DATA_DIR}/uploads/<job>/` deleted when the job ends or at recovery | PRD §4.7 |

## 19.2 Interface

```ts
preview(actor, source: { upload: UploadId } | { adapterId; path }, opts: { sheet?; headerRow?; delimiter? }): Promise<{
  columns: string[]; rows: unknown[][]; sheets?: string[]; detected: { delimiter?; encoding; headerRow };
}>;
run(actor, slug, {
  adapterId; mappingId; source; mode: "append" | "upsert" | "replace";
  dryRun: boolean; stashFirst?: boolean; foreignKeyChecks?: boolean;
}, event): Promise<Job>;
sample(actor, adapterId, table: TableRef, opts: { format: "csv" | "xlsx"; mappingId?: string }): ReadableStream;
```

Mapping JSON:

```json
{ "target": "public.customers",
  "columns": [
    { "source": "Email", "target": "email", "transforms": [{ "kind": "trim" }, { "kind": "lowercase" }] },
    { "source": "Joined", "target": "joined_at", "transforms": [{ "kind": "date", "format": "dd/MM/yyyy", "timezone": "Asia/Jakarta" }] },
    { "source": "Password", "target": "password_hash", "transforms": [{ "kind": "hash", "algorithm": "bcrypt" }] },
    { "source": null, "target": "id", "transforms": [{ "kind": "uuid" }] }
  ],
  "key_columns": ["email"], "mode": "upsert",
  "options": { "delimiter": ",", "header_row": 1, "encoding": "utf-8" } }
```

## 19.3 Pipeline

```text
run job:
  1. resolve adapter (Tabular, sandbox unless dryRun), mapping, source stream
  2. stash when required (replace, or stash_first)                     -> import_runs.stash_state_id
  3. introspect target table; check policies against the mapping        -> VALIDATION_ERROR before any row
  4. parse -> for each source row: apply transforms -> validateImportRow
       dry run: collect errors (first 100), count; stop after the file; no writes
       real run: batch valid rows; invalid rows go to rejected.csv with reason
  5. writeRows(batch, mode, keyColumns, foreignKeyChecks) inside one transaction where the engine allows
       batch failure: retry row by row; failing rows to rejected.csv with the engine's message
  6. commit; report counts; hooks.run("after_import")
  7. delete the upload; keep rejected.csv
```

`replace` empties the table with `DELETE FROM` inside the transaction (never `TRUNCATE`, which commits implicitly on MySQL); on Postgres, tables referenced from outside are refused before the delete, same rule as checkout.

## 19.4 Sample file contents

CSV: line 1 headers (table columns in schema order, or the mapping's `source` names), line 2 one example row built from types (`2026-01-31` for dates, `123.45` for numerics, `true` for booleans, `example` for text, `{}` for JSON, blank for nullable columns without default), then a commented block:

```text
# column, type, nullable, default, foreign key, required
# id, uuid, no, gen_random_uuid(), , no (generated when omitted)
# email, text, no, , , yes
# customer_id, bigint, yes, , public.customers(id), no
```

XLSX: sheet `data` with headers and the example row; sheet `schema` with the same columns as the comment block; required columns bold in the header row. The sample carries no real data.

## 19.5 Performance targets

| Path | Target | Source |
| --- | --- | --- |
| Parse | 50 000 rows/s CSV; 10 000 rows/s XLSX | Library benchmarks, estimate |
| Write | engine restore rates in 12 §12.6 | Spike |
| Dry run | parse rate; no engine writes | Design |
| Memory | one batch in flight; XLSX read as a stream | 08 §8.4 |

## 19.6 Security constraints

`qa` role and `sandbox` adapter for a real run; `viewer` may preview and download samples. Uploads are written under a per-job directory with a random name; the file name from the client is never used on disk. Files are parsed, never executed; formulas are read by cached value only. Rejected rows may contain data and are downloadable by `viewer` within project scope; masks do not apply (the file is the user's own input).

## 19.7 Component and contract

`modules/imports/{imports.csv.ts, imports.xlsx.ts, imports.transforms.ts, imports.validate.ts, imports.job.ts, imports.sample.ts, imports.service.ts, imports.repository.ts}`. Locked: the mapping JSON shape, the transform kinds, the rejected-rows layout, the sample layout.

## 19.8 What this does not do

- No import into MongoDB (Document tier).
- No multi-table import in one run; one mapping is one table.
- No schema creation; the table must exist.
- No streaming of the report; the job result carries counts, the file carries rows.

## 19.9 Cross-references

| Concern | Source |
| --- | --- |
| Engine write path and FK toggle | [12-engine-port.md](12-engine-port.md) §12.3, ADR 0001 |
| Column policies and hash functions | [24-table-editing.md](24-table-editing.md) |
| Storage source | 05 §5.11, 10 §10.3 |
| Stash | 05 §5.8 |
| Retention | 05 §5.16 |

## 19.10 Open follow-ups

| Item | Revisit when |
| --- | --- |
| JSON and NDJSON sources | Users import API dumps |
| Multi-table import with FK resolution by natural keys | Fixture extraction (24) proves the inverse is wanted |
