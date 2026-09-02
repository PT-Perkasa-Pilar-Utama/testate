import type { Normalizer, TableSchema } from "@testate/shared";

import { canonicalType } from "../../lib/engines/pure/fingerprint.ts";
import { csvLine } from "./imports.csv.ts";

const EXAMPLES = new Map<string, string>([
  ["integer", "123"],
  ["bigint", "123"],
  ["smallint", "123"],
  ["numeric", "123.45"],
  ["real", "123.45"],
  ["double precision", "123.45"],
  ["boolean", "true"],
  ["date", "2026-01-31"],
  ["uuid", "01991f00-0000-7000-8000-000000000001"],
  ["json", "{}"],
  ["jsonb", "{}"],
]);

/** One typed example value per canonical type (19 §19.4). */
export function exampleFor(column: TableSchema["columns"][number]): string {
  if (column.nullable && !column.has_default) return "";
  const type = canonicalType(column.type);
  if (type.startsWith("timestamp")) return "2026-01-31T08:00:00Z";
  return EXAMPLES.get(type) ?? "example";
}

function required(column: TableSchema["columns"][number]): string {
  if (column.identity || column.generated) return "no (generated when omitted)";
  return column.nullable || column.has_default ? "no" : "yes";
}

/** Header, one example row, then the schema block as comments; the normalizer's source names when given. */
export function sampleCsv(table: TableSchema, normalizer: Normalizer | null): string {
  const columns =
    normalizer === null
      ? table.columns
      : normalizer.columns.flatMap((item) => {
          const column = table.columns.find((candidate) => candidate.name === item.target);
          return column === undefined || item.source === null
            ? []
            : [{ ...column, name: item.source }];
        });
  const lines = [csvLine(columns.map((column) => column.name)), csvLine(columns.map(exampleFor))];
  lines.push("# column, type, nullable, default, foreign key, required");
  for (const column of table.columns) {
    const fk = table.foreign_keys_out.find((item) => item.columns.includes(column.name));
    const reference =
      fk === undefined
        ? ""
        : `${fk.ref.schema ?? ""}.${fk.ref.name}(${fk.ref_columns.join(",")})`.replace(/^\./, "");
    lines.push(
      `# ${column.name}, ${column.type}, ${column.nullable ? "yes" : "no"}, ${column.has_default ? "default" : ""}, ${reference}, ${required(column)}`
    );
  }
  return `${lines.join("\n")}\n`;
}
