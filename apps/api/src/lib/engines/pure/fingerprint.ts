import type { Introspection, TableSchema } from "@testate/shared";

import { sha256 } from "../../password/index.ts";
import { tableKey } from "../types.ts";

/** Engine spellings that mean the same type (14 §14.1); precision and scale stay in the text. */
const CANONICAL: readonly [RegExp, string][] = [
  [/^character varying(\(\d+\))?$/, "varchar$1"],
  [/^character(\(\d+\))?$/, "char$1"],
  [/^integer$/, "int"],
  [/^int4$/, "int"],
  [/^int8$/, "bigint"],
  [/^int2$/, "smallint"],
  [/^float8$/, "double precision"],
  [/^float4$/, "real"],
  [/^bool$/, "boolean"],
  [/^timestamp(\(\d+\))? with time zone$/, "timestamptz$1"],
  [/^timestamp(\(\d+\))? without time zone$/, "timestamp$1"],
  [/^time(\(\d+\))? with time zone$/, "timetz$1"],
  [/^time(\(\d+\))? without time zone$/, "time$1"],
  [/^decimal(\(.+\))?$/, "numeric$1"],
];

export function canonicalType(type: string): string {
  const lower = type.trim().toLowerCase();
  for (const [pattern, replacement] of CANONICAL) {
    if (pattern.test(lower)) return lower.replace(pattern, replacement);
  }
  return lower;
}

type CanonicalTable = {
  schema: string | null;
  name: string;
  kind: string;
  columns: {
    name: string;
    type: string;
    nullable: boolean;
    hasDefault: boolean;
    generated: boolean;
    identity: boolean;
  }[];
  primaryKey: string[] | null;
  foreignKeys: { columns: string[]; ref: string; refColumns: string[]; deferrable: boolean }[];
  unique: string[][];
};

function canonicalTable(table: TableSchema): CanonicalTable {
  return {
    schema: table.schema,
    name: table.name,
    kind: table.kind,
    columns: [...table.columns]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((column) => ({
        name: column.name,
        type: canonicalType(column.type),
        nullable: column.nullable,
        hasDefault: column.has_default,
        generated: column.generated,
        identity: column.identity,
      })),
    primaryKey: table.primary_key,
    foreignKeys: [...table.foreign_keys_out]
      .map((fk) => ({
        columns: fk.columns,
        ref: tableKey(fk.ref),
        refColumns: fk.ref_columns,
        deferrable: fk.deferrable,
      }))
      .sort((a, b) =>
        `${a.columns.join(",")}>${a.ref}`.localeCompare(`${b.columns.join(",")}>${b.ref}`)
      ),
    unique: [...table.unique]
      .map((set) => [...set].sort())
      .sort((a, b) => a.join(",").localeCompare(b.join(","))),
  };
}

/** The canonical JSON the fingerprint hashes; exported so tests can pin the included subset. */
export function canonicalIntrospection(introspection: Introspection): CanonicalTable[] {
  return [...introspection.tables]
    .filter((table) => !table.excluded)
    .sort((a, b) => tableKey(a).localeCompare(tableKey(b)))
    .map(canonicalTable);
}

/** SHA-256 over the canonical subset (14 §14.1): "sha256:<hex>". */
export function computeFingerprint(introspection: Introspection): string {
  return `sha256:${sha256(JSON.stringify(canonicalIntrospection(introspection)))}`;
}
