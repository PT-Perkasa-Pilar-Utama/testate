/**
 * What a person calls each value a reading holds, and how each unit reads (#38, #101). A key the
 * table does not name reads as its own words; a pm2 app's keys read as the app's name.
 */
import type { ResourceUnit } from "@testate/shared";

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
  ["cpu_percent", "CPU"],
  ["cpu_iowait", "I/O wait"],
  ["net_rx", "Received"],
  ["net_tx", "Sent"],
]);

const APP = /^app_(.+)_(cpu|memory|uptime)$/;
const APP_PART = new Map([
  ["cpu", "CPU"],
  ["memory", "memory"],
  ["uptime", "up for"],
]);

export function labelOf(key: string): string {
  const app = APP.exec(key);
  if (app !== null) return `${app[1] ?? ""} ${APP_PART.get(app[2] ?? "") ?? ""}`;
  return LABELS.get(key) ?? key.replaceAll("_", " ");
}

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
  bytes: (value) => formatBytes(Math.round(value)),
  count: (value) => Math.round(value).toLocaleString("en-GB"),
  ratio: (value) => `${(value * 100).toFixed(1)}%`,
  seconds: duration,
  load: (value) => value.toFixed(2),
  percent: (value) => `${value.toFixed(value >= 10 || Number.isInteger(value) ? 0 : 1)}%`,
  bytes_per_second: (value) => `${formatBytes(Math.round(value))}/s`,
};

export const formatValue = (value: number, unit: ResourceUnit): string => FORMAT[unit](value);
