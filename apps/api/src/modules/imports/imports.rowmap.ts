import type { JsonObject, JsonValue, Mapping, TableSchema } from "@testate/shared";
import type { parseOptionsSchema } from "@testate/shared";
import type * as v from "valibot";

import type { RowValues } from "../../lib/engines/index.ts";
import { AppError } from "../../lib/http/index.ts";
import type { ReadOptions } from "./imports.csv.ts";
import { TransformError, applyTransforms } from "./imports.transforms.ts";
import { validateImportRow } from "./imports.validate.ts";

export type Rejected = { row_number: number; reason: string; source: string[] };

export type RowTarget = { mapping: Mapping; table: TableSchema; keyColumns: string[] };

/** A parsed source row through the mapping: transforms per column, then the row check (19 §19.3 step 4). */
async function transformRow(
  mapping: Mapping,
  columns: string[],
  source: string[]
): Promise<JsonObject> {
  const row: JsonObject = {};
  for (const column of mapping.columns) {
    const index = column.source === null ? -1 : columns.indexOf(column.source);
    if (column.source !== null && index === -1) {
      throw new AppError(
        "VALIDATION_ERROR",
        `source column ${column.source} is missing from the file`,
        { column: column.source }
      );
    }
    const raw: JsonValue = index === -1 ? null : (source[index] ?? "");
    try {
      row[column.target] = await applyTransforms(raw, column.transforms);
    } catch (cause: unknown) {
      if (cause instanceof TransformError)
        throw new TransformError(`${column.target}: ${cause.message}`);
      throw cause;
    }
  }
  return row;
}

export function toValues(row: JsonObject): RowValues {
  const values: RowValues = {};
  for (const [column, value] of Object.entries(row)) values[column] = { kind: "value", value };
  return values;
}

type ParseOptions = v.InferOutput<typeof parseOptionsSchema>;

/** Request options win over the mapping's (07 §7.4). */
export function readOptionsOf(request: ParseOptions, mapping: ParseOptions): ReadOptions {
  const options: ReadOptions = {};
  const delimiter = request.delimiter ?? mapping.delimiter;
  if (delimiter !== undefined) options.delimiter = delimiter;
  const headerRow = request.header_row ?? mapping.header_row;
  if (headerRow !== undefined) options.headerRow = headerRow;
  return options;
}

/** Transform and validate one source row; a problem becomes a rejected row, never a throw. */
export async function classify(
  prepared: RowTarget,
  columns: string[],
  source: string[],
  rowNumber: number
): Promise<{ row: JsonObject } | { rejected: Rejected }> {
  try {
    const row = await transformRow(prepared.mapping, columns, source);
    const problem = validateImportRow(row, prepared.table, prepared.keyColumns);
    return problem === null
      ? { row }
      : { rejected: { row_number: rowNumber, reason: problem, source } };
  } catch (cause: unknown) {
    if (!(cause instanceof TransformError)) throw cause;
    return { rejected: { row_number: rowNumber, reason: cause.message, source } };
  }
}
