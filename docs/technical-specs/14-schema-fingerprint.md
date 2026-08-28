# 14. Schema Fingerprint

The schema fingerprint is a hash of the introspection subset that decides whether a state's data can be restored into a live schema. It is stored with every state's adapter manifest and compared at checkout, in pre-flight, and in the deletion plan. Cite this document for what goes into the hash and what is left out.

## 14.1 Decision matrix

| Concern | Decision | Rationale |
| --- | --- | --- |
| Purpose | Catch changes that make a restore unsafe; ignore changes that do not | Story 74, 75; an online table rebuild must not trip drift |
| Algorithm | SHA-256 over a canonical JSON of the included subset, columns sorted by name, tables sorted by schema-qualified name | Deterministic across engines and runs |
| Included | Tables (schema, name, kind), columns (name, canonical type, nullable, has default, generated, identity), primary keys, foreign keys (columns, referenced table, referenced columns, deferrable), unique constraints (column sets), check constraints (normalized expression text), MongoDB collection options (capped, time-series, validator) | Each changes whether rows fit or constraints hold |
| Excluded | Physical column order, index names and definitions, comments, storage parameters, sequence values, statistics, view definitions, MongoDB index definitions, table and column privileges | None affects whether data fits |
| Type canonicalization | Engine type names mapped to a canonical form (`varchar(255)` and `character varying(255)` are one; `int` and `integer` are one); precision and scale kept | Avoids false drift between introspection paths |
| Drift shape | `SchemaDrift = { changed: boolean; tables: { added, removed }; columns: { added, removed, typeChanged, nullabilityChanged }; constraints: { added, removed } }` | Pre-flight and error details show exactly what differs |
| Force semantics | Intersection of tables and of columns by name with equal canonical type; a live column absent from the state receives its default (must be nullable or have a default, else the table is skipped); a state column absent live is dropped from the insert | Story 75 |

## 14.2 Interface

```ts
computeFingerprint(introspection: Introspection): string;                 // "sha256:9f3c..."
diffSchema(baseline: Introspection, live: Introspection): SchemaDrift;
forceIntersection(baseline: Introspection, live: Introspection): {
  tables: TableRef[]; skippedTables: TableRef[]; skippedColumns: ColumnRef[]; defaultedColumns: ColumnRef[];
};
```

Canonical JSON example (one table):

```json
{ "schema": "public", "name": "orders", "kind": "table",
  "columns": [
    { "name": "id", "type": "bigint", "nullable": false, "hasDefault": true, "generated": false, "identity": true },
    { "name": "status", "type": "text", "nullable": false, "hasDefault": true, "generated": false, "identity": false },
    { "name": "total", "type": "numeric(12,2)", "nullable": true, "hasDefault": false, "generated": false, "identity": false }
  ],
  "primaryKey": ["id"],
  "foreignKeys": [ { "columns": ["customer_id"], "ref": "public.customers", "refColumns": ["id"], "deferrable": false } ],
  "unique": [["order_number"]],
  "checks": ["(total >= 0)"] }
```

## 14.3 False-drift cases (must stay equal)

| Change | Fingerprint |
| --- | --- |
| Online rebuild by gh-ost or pt-online-schema-change with the same columns | equal |
| Column reordered | equal |
| Index added, dropped, or renamed | equal |
| Comment added | equal |
| Sequence advanced | equal |
| View redefined | equal |
| MongoDB index added | equal |
| Autovacuum or statistics changes | equal |

## 14.4 True-drift cases (must differ)

| Change | Effect |
| --- | --- |
| Column added `NOT NULL` without default | drift; force skips the table |
| Column added nullable or with default | drift; force restores and lists the column as defaulted |
| Column type changed (`int` to `bigint`) | drift; force skips the column only when the canonical types differ |
| Column dropped | drift; force drops it from the insert |
| Table added or dropped | drift; force restores the intersection |
| Foreign key added | drift; dependency order recomputed under force |
| Check constraint changed | drift; force restores, the engine reports batch failures if rows violate it |
| MongoDB validator changed | drift; force restores, insert failures reported per batch |

## 14.5 Performance targets

| Path | Target | Source |
| --- | --- | --- |
| Fingerprint on 500 tables | under 200 ms after introspection | Pure computation |
| Diff on 500 tables | under 200 ms | Pure computation |

## 14.6 Security constraints

None beyond introspection privileges; the fingerprint contains no data.

## 14.7 Component and contract

`lib/engines/pure/fingerprint.ts`, `diff-schema.ts`, `force.ts`; canonical type map in `lib/engines/pure/types-canonical.ts` with one entry per engine. Locked: the included list in §14.1 and the `SchemaDrift` shape. Adding a field to the included list is a breaking change to every stored fingerprint and needs a migration that recomputes fingerprints from stored introspections.

## 14.8 What this does not do

- No data hashing; that is the blob store's content address.
- No index or privilege comparison.
- No automatic repair.

## 14.9 Cross-references

| Concern | Source |
| --- | --- |
| Introspection shape | ADR 0001, [12-engine-port.md](12-engine-port.md) |
| Use at checkout | [13-checkout-and-restore.md](13-checkout-and-restore.md) §13.2 |
| Stored per state | 06 §6.5 `state_adapters.fingerprint`, `introspection` |

## 14.10 Open follow-ups

| Item | Revisit when |
| --- | --- |
| Include collation in the canonical type | A restore fails on a collation-only change |
| Per-table fingerprints for finer force | Users want to force a single table |
