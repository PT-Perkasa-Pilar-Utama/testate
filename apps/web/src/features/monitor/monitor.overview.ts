/**
 * The Monitor menu (#101): every host and database server across the projects the caller can
 * see, from each project's newest reading. A value the reading lacks is null, never zero.
 */
import type { Project, Reading, ReadingAdapter } from "@testate/shared";

export type HostRow = {
  key: string;
  project: Project;
  name: string;
  cpu: number | null;
  /** Used over total, from 0 to 1. */
  memory: number | null;
  disk: number | null;
  load: number | null;
  apps: number;
  taken_at: string;
};

export type ServerRow = {
  key: string;
  project: Project;
  name: string;
  connections: number | null;
  size: number | null;
  taken_at: string;
};

export type Overview = { hosts: HostRow[]; servers: ServerRow[] };

const valueOf = (adapter: ReadingAdapter, key: string): number | null =>
  adapter.values.find((item) => item.key === key)?.value ?? null;

function usedOf(adapter: ReadingAdapter, total: string, free: string): number | null {
  const all = valueOf(adapter, total);
  const left = valueOf(adapter, free);
  return all === null || left === null || all <= 0 ? null : (all - left) / all;
}

export function overviewOf(
  latest: readonly { project: Project; reading: Reading | null }[]
): Overview {
  const hosts: HostRow[] = [];
  const servers: ServerRow[] = [];
  for (const { project, reading } of latest) {
    for (const adapter of reading?.adapters ?? []) {
      const base = {
        key: `${project.id}:${adapter.adapter_id}`,
        project,
        name: adapter.name,
        taken_at: reading?.taken_at ?? "",
      };
      if (adapter.source === "host")
        hosts.push({
          ...base,
          cpu: valueOf(adapter, "cpu_percent"),
          memory: usedOf(adapter, "memory_total", "memory_available"),
          disk: usedOf(adapter, "disk_total", "disk_free"),
          load: valueOf(adapter, "load_1m"),
          apps: adapter.values.filter((item) => /^app_.+_cpu$/.test(item.key)).length,
        });
      else
        servers.push({
          ...base,
          connections: valueOf(adapter, "connections"),
          size: valueOf(adapter, "database_size") ?? valueOf(adapter, "data_size"),
        });
    }
  }
  return { hosts, servers };
}
