import type { JsonValue } from "@testate/shared";

import { AppError } from "../../lib/http/index.ts";

export type Delimiter = "," | ";" | "\t" | "|";

const DELIMITERS: Delimiter[] = [",", ";", "\t", "|"];

/** The delimiter that splits the first line into the most fields, ties to the comma (19 §19.1). */
export function detectDelimiter(text: string): Delimiter {
  const line = text.split(/\r?\n/, 1)[0] ?? "";
  let best: Delimiter = ",";
  let count = 0;
  for (const candidate of DELIMITERS) {
    const found = line.split(candidate).length - 1;
    if (found > count) {
      best = candidate;
      count = found;
    }
  }
  return best;
}

type Scan = { rows: string[][]; row: string[]; field: string; quoted: boolean };

/** Inside quotes: a doubled quote is a literal quote; a lone quote closes the field. */
function scanQuoted(scan: Scan, char: string, next: string | undefined): number {
  if (char === '"' && next === '"') {
    scan.field += '"';
    return 2;
  }
  if (char === '"') scan.quoted = false;
  else scan.field += char;
  return 1;
}

function endRow(scan: Scan): void {
  scan.row.push(scan.field);
  scan.rows.push(scan.row);
  scan.row = [];
  scan.field = "";
}

function scanPlain(
  scan: Scan,
  char: string,
  next: string | undefined,
  delimiter: Delimiter
): number {
  if (char === '"') {
    scan.quoted = true;
  } else if (char === delimiter) {
    scan.row.push(scan.field);
    scan.field = "";
  } else if (char === "\n" || char === "\r") {
    endRow(scan);
    return char === "\r" && next === "\n" ? 2 : 1;
  } else {
    scan.field += char;
  }
  return 1;
}

/** RFC 4180: quoted fields, doubled quotes, newlines inside quotes; a BOM is dropped. */
export function parseCsv(text: string, delimiter: Delimiter): string[][] {
  const source = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const scan: Scan = { rows: [], row: [], field: "", quoted: false };
  let index = 0;
  while (index < source.length) {
    const char = source[index] ?? "";
    const next = source[index + 1];
    index += scan.quoted ? scanQuoted(scan, char, next) : scanPlain(scan, char, next, delimiter);
  }
  if (scan.quoted) throw new AppError("VALIDATION_ERROR", "unterminated quoted field");
  if (scan.field !== "" || scan.row.length > 0) endRow(scan);
  return scan.rows.filter((line) => line.some((cell) => cell !== ""));
}

export type ReadOptions = { delimiter?: Delimiter; headerRow?: number };

export type CsvTable = {
  columns: string[];
  rows: string[][];
  delimiter: Delimiter;
  headerRow: number;
};

/** Header at `headerRow` (1-based); rows below it, padded to the header width. */
export function readCsv(
  text: string,
  options: { delimiter?: Delimiter; headerRow?: number }
): CsvTable {
  const delimiter = options.delimiter ?? detectDelimiter(text);
  const headerRow = options.headerRow ?? 1;
  const all = parseCsv(text, delimiter);
  const columns = all[headerRow - 1];
  if (columns === undefined)
    throw new AppError("VALIDATION_ERROR", "the file has no header row", { header_row: headerRow });
  const rows = all.slice(headerRow).map((row) => columns.map((_name, index) => row[index] ?? ""));
  return { columns, rows, delimiter, headerRow };
}

export function csvCell(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(values: (JsonValue | undefined)[]): string {
  return values.map(csvCell).join(",");
}
