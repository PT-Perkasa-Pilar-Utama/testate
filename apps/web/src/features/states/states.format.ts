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

const CONSISTENCY_LABEL = {
  snapshot: "consistent snapshot",
  best_effort: "best effort",
} as const satisfies Record<StateAdapter["consistency"], string>;

/** "best_effort" -> "best effort"; a person never typed the underscore. */
export function consistencyLabel(consistency: StateAdapter["consistency"]): string {
  return CONSISTENCY_LABEL[consistency];
}
