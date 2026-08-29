import { AppError } from "../../lib/http/index.ts";
import { isZip, readXlsx } from "../../lib/xlsx/index.ts";
import { readCsv } from "./imports.csv.ts";
import type { CsvTable, ReadOptions } from "./imports.csv.ts";

export type TableOptions = ReadOptions & { sheet?: string };

export type SourceTable = Omit<CsvTable, "delimiter"> & {
  delimiter?: CsvTable["delimiter"];
  sheets?: string[];
};

/** A source file as one table: an OOXML workbook by its ZIP magic, anything else as delimited text. */
export function readTable(bytes: Uint8Array, options: TableOptions): SourceTable {
  if (!isZip(bytes)) return readCsv(new TextDecoder().decode(bytes), options);
  let workbook;
  try {
    workbook = readXlsx(bytes, options.sheet);
  } catch (cause: unknown) {
    throw new AppError("VALIDATION_ERROR", cause instanceof Error ? cause.message : String(cause));
  }
  const headerRow = options.headerRow ?? 1;
  const columns = workbook.rows[headerRow - 1];
  if (columns === undefined)
    throw new AppError("VALIDATION_ERROR", "the sheet has no header row", {
      header_row: headerRow,
    });
  const rows = workbook.rows
    .slice(headerRow)
    .map((row) => columns.map((_name, index) => row[index] ?? ""));
  return { columns, rows, headerRow, sheets: workbook.sheets };
}
