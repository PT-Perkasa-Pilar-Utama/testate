import type { ColumnPolicy, JsonObject, JsonValue, Mapping, TableSchema } from "@testate/shared";
import * as v from "valibot";

import { AppError } from "../../lib/http/index.ts";
import { canonicalType } from "../../lib/engines/pure/fingerprint.ts";

/** The hash algorithm a policy's function name maps to (24 §24.4 ↔ 19 §19.1 transforms). */
const POLICY_TO_HASH = new Map<string, string>([
  ["hash_bcrypt", "bcrypt"],
  ["hash_argon2id", "argon2id"],
  ["hash_sha256", "sha256"],
  ["hash_sha512", "sha512"],
  ["hmac_sha256", "hmac_sha256"],
]);

type MappingSpec = Pick<Mapping, "target" | "columns" | "key_columns" | "mode">;

function assertTargets(mapping: MappingSpec, table: TableSchema): void {
  const names = new Set(table.columns.map((column) => column.name));
  for (const column of mapping.columns) {
    if (!names.has(column.target)) {
      throw new AppError("VALIDATION_ERROR", `unknown target column ${column.target}`, {
        column: column.target,
      });
    }
  }
}

function assertKeys(mapping: MappingSpec): void {
  if (mapping.mode === "upsert" && mapping.key_columns.length === 0) {
    throw new AppError("VALIDATION_ERROR", "upsert needs key_columns");
  }
  for (const key of mapping.key_columns) {
    if (!mapping.columns.some((column) => column.target === key)) {
      throw new AppError("VALIDATION_ERROR", `key column ${key} is not mapped`, { column: key });
    }
  }
}

function assertPolicies(mapping: MappingSpec, policies: ColumnPolicy[]): void {
  for (const policy of policies) {
    const required = policy.required_function;
    const mapped = mapping.columns.find((column) => column.target === policy.column);
    if (required === null || mapped === undefined) continue;
    const algorithm = POLICY_TO_HASH.get(required.name);
    const carries = mapped.transforms.some(
      (transform) => transform.kind === "hash" && transform.algorithm === algorithm
    );
    if (!carries) {
      throw new AppError(
        "VALIDATION_ERROR",
        `${policy.column} requires the ${required.name} function`,
        { column: policy.column, function: required.name }
      );
    }
  }
}

/** Target exists, target columns exist, upsert has keys, policed columns carry their hash (07 §7.3). */
export function validateMapping(
  mapping: MappingSpec,
  table: TableSchema,
  policies: ColumnPolicy[]
): void {
  assertTargets(mapping, table);
  assertKeys(mapping);
  assertPolicies(mapping, policies);
}

const NUMERIC = new Set(["integer", "bigint", "smallint", "numeric", "real", "double precision"]);

function typeMatches(type: string, value: JsonValue): boolean {
  // `numeric(24,4)` and `varchar(80)` carry a size; the family decides the check.
  const canonical = canonicalType(type).replace(/\(.*\)$/, "");
  if (NUMERIC.has(canonical))
    return (
      v.is(v.number(), value) || (v.is(v.string(), value) && /^-?\d+(\.\d+)?$/.test(value.trim()))
    );
  if (canonical === "boolean")
    return (
      v.is(v.boolean(), value) || (v.is(v.string(), value) && /^(true|false|t|f|0|1)$/i.test(value))
    );
  if (canonical === "json" || canonical === "jsonb") return true;
  return true;
}

/** Type, nullability, key presence per column; the first problem names the column (19 §19.1 dry run). */
export function validateImportRow(
  row: JsonObject,
  table: TableSchema,
  keyColumns: string[]
): string | null {
  for (const key of keyColumns) {
    if (row[key] === undefined || row[key] === null) return `${key}: key column is empty`;
  }
  for (const column of table.columns) {
    const value = row[column.name];
    if (value === undefined) continue;
    if (value === null) {
      if (!column.nullable && !column.has_default)
        return `${column.name}: null in a NOT NULL column`;
      continue;
    }
    if (!typeMatches(column.type, value))
      return `${column.name}: not a ${canonicalType(column.type)}`;
  }
  return null;
}
