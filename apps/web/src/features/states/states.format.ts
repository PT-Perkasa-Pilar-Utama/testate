import type { ManifestTable, StateAdapter } from "@testate/shared";

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** 1536 -> "1.5 KB"; integer bytes only, base 1024. */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${UNITS[unit]}`;
}

const SORT_LABEL = {
  "primary-key": "primary key order",
  "row-hash": "row hash order",
} as const satisfies Record<ManifestTable["sort"], string>;

/** "primary-key" -> "primary key order"; the manifest's own word for how a table was walked. */
export function sortLabel(sort: ManifestTable["sort"]): string {
  return SORT_LABEL[sort];
}

/** The tables whose qualified name holds the text, case-insensitively; all of them for none. */
export function matchingTables<T extends { schema: string | null; name: string }>(
  tables: readonly T[],
  wanted: string
): T[] {
  const needle = wanted.trim().toLowerCase();
  return tables.filter((table) =>
    (table.schema === null ? table.name : `${table.schema}.${table.name}`)
      .toLowerCase()
      .includes(needle)
  );
}

/**
 * Which databases a state covers, for the one line the timeline gives it. A bare count answers
 * "how many" when the question a tester asks is "is mine in there"; past two names the count
 * comes back as a "+N" so a state that spans ten adapters still fits on one line.
 */
export function adapterSummary(adapters: readonly StateAdapter[]): string {
  const names = adapters.map((adapter) => adapter.adapter_name);
  if (names.length === 0) return "no databases";
  if (names.length <= 2) return names.join(", ");
  return `${names[0]}, ${names[1]} +${names.length - 2}`;
}

/** "restored twice, in 1 diff": what this state produced, and nothing when it produced nothing. */
export function eventsLabel(state: { checkout_count: number; diff_count: number }): string {
  const parts: string[] = [];
  if (state.checkout_count === 1) parts.push("restored once");
  if (state.checkout_count > 1) parts.push(`restored ${state.checkout_count} times`);
  if (state.diff_count === 1) parts.push("in 1 diff");
  if (state.diff_count > 1) parts.push(`in ${state.diff_count} diffs`);
  return parts.join(", ");
}
