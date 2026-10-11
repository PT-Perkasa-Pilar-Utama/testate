/**
 * Two resource readings side by side (#38, Q8): per adapter and value, the older, the newer and
 * the change. A value one reading lacks shows as unavailable on that side, never as zero.
 */
import type { Reading, ResourceUnit } from "@testate/shared";

import { formatBytes } from "../states/states.format.ts";

const LABELS: Map<string, string> = new Map([
  ["load_1m", "Load, 1 min"],
  ["load_5m", "Load, 5 min"],
  ["load_15m", "Load, 15 min"],
  ["cpu_count", "CPUs"],
  ["memory_total", "Memory"],
  ["memory_available", "Memory available"],
  ["swap_total", "Swap"],
  ["swap_free", "Swap free"],
  ["disk_total", "Disk"],
  ["disk_free", "Disk free"],
  ["uptime", "Up for"],
  ["connections", "Connections"],
  ["active_connections", "Active connections"],
  ["max_connections", "Connection limit"],
  ["max_used_connections", "Most connections at once"],
  ["available_connections", "Connections left"],
  ["database_size", "Database size"],
  ["commits", "Commits"],
  ["rollbacks", "Rollbacks"],
  ["deadlocks", "Deadlocks"],
  ["cache_hit_ratio", "Cache hits"],
  ["questions", "Statements"],
  ["slow_queries", "Slow queries"],
  ["collections", "Collections"],
  ["documents", "Documents"],
  ["data_size", "Data size"],
  ["storage_size", "Storage size"],
  ["index_size", "Index size"],
  ["resident_memory", "Resident memory"],
  ["adapter", "Whole adapter"],
]);

export const labelOf = (key: string): string => LABELS.get(key) ?? key.replaceAll("_", " ");

function duration(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0) return `${minutes} min`;
  return `${Math.round(seconds)} s`;
}

const FORMAT: Record<ResourceUnit, (value: number) => string> = {
  bytes: (value) => formatBytes(value),
  count: (value) => Math.round(value).toLocaleString("en-GB"),
  ratio: (value) => `${(value * 100).toFixed(1)}%`,
  seconds: duration,
  load: (value) => value.toFixed(2),
};

export const formatValue = (value: number, unit: ResourceUnit): string => FORMAT[unit](value);

/** "+12", "-1.5 GB", "+0.3%"; null when either side has no value. */
export function changeOf(
  older: number | null,
  newer: number | null,
  unit: ResourceUnit
): string | null {
  if (older === null || newer === null) return null;
  const delta = newer - older;
  if (delta === 0) return "no change";
  const sign = delta > 0 ? "+" : "-";
  return `${sign}${formatValue(Math.abs(delta), unit)}`;
}

export type CompareRow = {
  adapter: string;
  key: string;
  unit: ResourceUnit;
  older: number | null;
  newer: number | null;
};

type Values = Map<string, { value: number; unit: ResourceUnit }>;

function valuesBy(reading: Reading): Map<string, Values> {
  return new Map(
    reading.adapters.map((adapter) => [
      adapter.name,
      new Map(adapter.values.map((item) => [item.key, { value: item.value, unit: item.unit }])),
    ])
  );
}

/** Every adapter and key either reading has, the older reading's order first. */
export function compareReadings(older: Reading, newer: Reading): CompareRow[] {
  const before = valuesBy(older);
  const after = valuesBy(newer);
  const rows: CompareRow[] = [];
  const seen = new Set<string>();
  for (const [adapter, values] of [...before, ...after]) {
    for (const [key, { unit }] of values) {
      const id = `${adapter}\u0000${key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      rows.push({
        adapter,
        key,
        unit,
        older: before.get(adapter)?.get(key)?.value ?? null,
        newer: after.get(adapter)?.get(key)?.value ?? null,
      });
    }
  }
  return rows;
}
