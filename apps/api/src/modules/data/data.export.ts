import type { JsonObject } from "@testate/shared";

import { csvLine } from "../imports/imports.csv.ts";

/** Rows leave one line at a time (06 §6.8): a CSV header then `csvLine` rows, or a JSON array. */
export function exportStream(
  result: { columns: { name: string }[]; rows: JsonObject[] },
  format: "csv" | "json"
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const names = result.columns.map((column) => column.name);
  let index = -1;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      index += 1;
      if (index === 0) {
        controller.enqueue(encoder.encode(format === "csv" ? `${csvLine(names)}\n` : "["));
        return;
      }
      const row = result.rows[index - 1];
      if (row === undefined) {
        if (format === "json") controller.enqueue(encoder.encode("]"));
        controller.close();
        return;
      }
      const line =
        format === "csv"
          ? `${csvLine(names.map((name) => row[name]))}\n`
          : `${index === 1 ? "" : ","}${JSON.stringify(row)}`;
      controller.enqueue(encoder.encode(line));
    },
  });
}

export type ExportPage = {
  columns: { name: string }[];
  rows: JsonObject[];
  nextCursor: string | null;
};

/**
 * A whole table, one keyset page at a time (06 §6.8).
 *
 * Nothing is capped. The query export caps at `limits.query_rows_max` because an ad-hoc query can
 * be a mistake; asking for a table is not, and a silent truncation is how the old export handed
 * people 500 rows and let them believe it was all of them. Memory stays bounded because only one
 * page is held at a time, and a reader who changes their mind cancels the download.
 */
function rowLine(
  row: JsonObject,
  names: string[],
  format: "csv" | "json",
  precededByARow: boolean
): string {
  if (format === "csv") return `${csvLine(names.map((name) => row[name]))}\n`;
  return `${precededByARow ? "," : ""}${JSON.stringify(row)}`;
}

export function pagedExportStream(
  pages: AsyncGenerator<ExportPage>,
  format: "csv" | "json"
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let names: string[] = [];
  let wroteAny = false;
  let started = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await pages.next();
      if (next.done === true) {
        if (!started) controller.enqueue(encoder.encode(format === "csv" ? "" : "["));
        controller.enqueue(encoder.encode(format === "csv" ? "" : "]"));
        controller.close();
        return;
      }
      const page = next.value;
      const parts: string[] = [];
      if (!started) {
        started = true;
        names = page.columns.map((column) => column.name);
        parts.push(format === "csv" ? `${csvLine(names)}\n` : "[");
      }
      for (const row of page.rows) {
        parts.push(rowLine(row, names, format, wroteAny));
        wroteAny = true;
      }
      if (parts.length > 0) controller.enqueue(encoder.encode(parts.join("")));
    },
    cancel: () => {
      void pages.return(undefined);
    },
  });
}
