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
