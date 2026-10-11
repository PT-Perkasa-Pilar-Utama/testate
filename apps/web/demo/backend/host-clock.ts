/**
 * The demo's machines move (#101): every second the app host's and the file host's `/proc` files
 * are rewritten from a load that drifts through the day, with a pm2 app on the app host. The
 * monitor reads them through the real host reader, so its graphs move while a visitor watches.
 * `history` writes the day before the visit from the same curve, so the graphs open full.
 */
import type { MemoryFile, MemoryTree } from "../../../api/src/lib/files/memory.ts";
import type { NewReading } from "../../../api/src/modules/readings/readings.repository.ts";
import type { ReadingAdapter } from "@testate/shared";

const CPUS = 4;
const HZ = 100;
const MEMORY_KB = 8_152_340;
const SWAP_KB = 2_097_148;
const BOOTED_SECONDS = 1_209_600;
/** pm2 restarted the app three hours before the visit; its uptime drops there in the graphs. */
const RESTART_MS = 3 * 3_600_000;
const PID = 4242;
/** A 100 GB disk, 38% used; the file source answers `statvfs` with this too. */
export const DISK = { f_frsize: 4096, f_blocks: 26_214_400, f_bavail: 16_252_928 };
const MINUTE = 60_000;
const HOUR = 3_600_000;

/** How busy a host is at `t`: a slow day curve, a faster wobble, and a little noise. */
export type Load = { cpu: number; iowait: number; memoryUsed: number; rx: number; tx: number };

const wave = (t: number, period: number, phase = 0): number =>
  Math.sin((2 * Math.PI * t) / period + phase);
/** Repeatable noise in [-1, 1] per 20-second slot, so a reload draws the same history. */
const noise = (t: number, salt: number): number => {
  const slot = Math.floor(t / 20_000) * 7919 + salt * 104_729;
  return ((Math.sin(slot) * 43_758.5453) % 1) * 2 - 1;
};

export function loadAt(t: number, scale: number): Load {
  const cpu = (40 + 14 * wave(t, 6 * HOUR) + 9 * wave(t, 17 * MINUTE, 1) + 5 * noise(t, 1)) * scale;
  return {
    cpu: Math.min(95, Math.max(2, cpu)),
    iowait: Math.max(0.2, (2 + 1.5 * wave(t, 41 * MINUTE, 2) + noise(t, 2)) * scale),
    memoryUsed: 0.42 + 0.08 * wave(t, 9 * HOUR, 0.5) + 0.02 * noise(t, 3),
    rx: Math.max(1000, (220_000 + 160_000 * wave(t, 2.5 * HOUR, 3) + 40_000 * noise(t, 4)) * scale),
    tx: Math.max(500, (70_000 + 50_000 * wave(t, 3.5 * HOUR, 4) + 15_000 * noise(t, 5)) * scale),
  };
}

/** The pm2 app: about half the host's CPU, and a resident size that creeps up since its restart. */
type AppLoad = { cpu: number; rss: number };

function appAt(t: number, load: Load, visit: number): AppLoad {
  const since = (t - (visit - RESTART_MS)) / HOUR;
  const growth = since >= 0 ? since : since + 24;
  return { cpu: load.cpu * 0.55, rss: (160 + 9 * growth + 6 * wave(t, 37 * MINUTE)) * 1_048_576 };
}

type Counters = {
  total: number;
  busy: number;
  iowait: number;
  rx: number;
  tx: number;
  app: number;
};

const encoder = new TextEncoder();
const file = (text: string, at: number): MemoryFile => ({
  bytes: encoder.encode(text),
  modified_at: new Date(at).toISOString(),
});

function procFiles(
  counters: Counters,
  load: Load,
  t: number,
  app: boolean,
  visit: number
): Map<string, string> {
  const idle = Math.round(counters.total - counters.busy - counters.iowait);
  const user = Math.round(counters.busy * 0.7);
  const system = Math.round(counters.busy - user);
  const iowait = Math.round(counters.iowait);
  const perCpu = (value: number): number => Math.round(value / CPUS);
  const cpuLines = Array.from(
    { length: CPUS },
    (_, i) =>
      `cpu${i} ${perCpu(user)} 0 ${perCpu(system)} ${perCpu(idle)} ${perCpu(iowait)} 0 0 0 0 0`
  );
  const uptime = BOOTED_SECONDS + t / 1000;
  const available = Math.round(MEMORY_KB * (1 - load.memoryUsed));
  const loadavg = ((load.cpu / 100) * CPUS * 1.1).toFixed(2);
  const files = new Map<string, string>([
    ["proc/loadavg", `${loadavg} ${loadavg} ${loadavg} 2/311 48213\n`],
    [
      "proc/meminfo",
      `MemTotal:        ${MEMORY_KB} kB\nMemFree:          921472 kB\nMemAvailable:    ${available} kB\nSwapTotal:       ${SWAP_KB} kB\nSwapFree:        ${SWAP_KB} kB\n`,
    ],
    ["proc/uptime", `${uptime.toFixed(2)} 4511820.11\n`],
    [
      "proc/stat",
      [`cpu  ${user} 0 ${system} ${idle} ${iowait} 0 0 0 0 0`, ...cpuLines, ""].join("\n"),
    ],
    [
      "proc/net/dev",
      `Inter-|   Receive |  Transmit\n face |bytes packets|bytes packets\n    lo: 1000 10 0 0 0 0 0 0 1000 10 0 0 0 0 0 0\n  eth0: ${Math.round(counters.rx)} 20 0 0 0 0 0 0 ${Math.round(counters.tx)} 30 0 0 0 0 0 0\n`,
    ],
  ]);
  if (app) {
    const started = Math.round((BOOTED_SECONDS + (visit - RESTART_MS) / 1000) * HZ);
    const ticks = Math.round(counters.app);
    files.set(".pm2/pids/shop-api-0.pid", `${PID}\n`);
    files.set(
      `proc/${PID}/stat`,
      `${PID} (node /home/deploy/shop-api/server.js) S 1 ${PID} ${PID} 0 -1 4194560 100 0 0 0 ${Math.round(ticks * 0.8)} ${Math.round(ticks * 0.2)} 0 0 20 0 11 0 ${started} 1000 2000\n`
    );
    files.set(
      `proc/${PID}/status`,
      `Name:\tnode\nVmRSS:\t${Math.round(appAt(t, load, visit).rss / 1024)} kB\n`
    );
  }
  return files;
}

type Host = { tree: MemoryTree; scale: number; app: boolean; counters: Counters };

/** Starts the clock over these trees; `now` is when the visit began. */
export function startHostClock(
  hosts: { tree: MemoryTree; scale: number; app: boolean }[],
  now: number
): void {
  const running: Host[] = hosts.map((host) => ({
    ...host,
    counters: { total: 1e9, busy: 3e8, iowait: 1e7, rx: 5e9, tx: 2e9, app: 4e7 },
  }));
  let last = now;
  const write = (): void => {
    const t = Date.now();
    const seconds = Math.max(0, (t - last) / 1000);
    last = t;
    for (const host of running) {
      const load = loadAt(t, host.scale);
      const ticks = seconds * CPUS * HZ;
      host.counters.total += ticks;
      host.counters.busy += ticks * (load.cpu / 100);
      host.counters.iowait += ticks * (load.iowait / 100);
      host.counters.rx += seconds * load.rx;
      host.counters.tx += seconds * load.tx;
      host.counters.app += seconds * HZ * (appAt(t, load, now).cpu / 100);
      for (const [path, text] of procFiles(host.counters, load, t, host.app, now))
        host.tree.set(path, file(text, t));
    }
  };
  write();
  setInterval(write, 1000);
}

const value = (key: string, v: number, unit: ReadingAdapter["values"][number]["unit"]) => ({
  key,
  value: Math.round(v * 10) / 10,
  unit,
});

function hostValues(
  t: number,
  scale: number,
  app: boolean,
  visit: number
): ReadingAdapter["values"] {
  const load = loadAt(t, scale);
  const values = [
    value("load_1m", (load.cpu / 100) * CPUS * 1.1, "load"),
    value("cpu_count", CPUS, "count"),
    value("memory_total", MEMORY_KB * 1024, "bytes"),
    value("memory_available", MEMORY_KB * 1024 * (1 - load.memoryUsed), "bytes"),
    value("disk_total", DISK.f_frsize * DISK.f_blocks, "bytes"),
    value("disk_free", DISK.f_frsize * DISK.f_bavail, "bytes"),
    value("cpu_percent", load.cpu, "percent"),
    value("cpu_iowait", load.iowait, "percent"),
    value("net_rx", load.rx, "bytes_per_second"),
    value("net_tx", load.tx, "bytes_per_second"),
  ];
  if (!app) return values;
  const proc = appAt(t, load, visit);
  const restarted = visit - RESTART_MS;
  const up = t >= restarted ? (t - restarted) / 1000 : (t - (restarted - 24 * HOUR)) / 1000;
  return [
    ...values,
    value("app_shop_api_0_cpu", proc.cpu, "percent"),
    value("app_shop_api_0_memory", proc.rss, "bytes"),
    value("app_shop_api_0_uptime", up, "seconds"),
  ];
}

export type HistoryAdapter = Omit<ReadingAdapter, "values" | "unavailable"> & {
  scale: number;
  app: boolean;
};

/** One polled reading every two minutes over the day before `visit`. */
export function history(
  projectId: string,
  adapters: HistoryAdapter[],
  visit: number
): NewReading[] {
  const rows: NewReading[] = [];
  for (let t = visit - 24 * HOUR; t < visit - MINUTE; t += 2 * MINUTE) {
    rows.push({
      id: Bun.randomUUIDv7(),
      project_id: projectId,
      taken_at: new Date(t).toISOString(),
      source: "poll",
      actor: { kind: "system", label: "Testate" },
      actor_id: null,
      adapters: adapters.map(({ scale, app, ...adapter }) => ({
        ...adapter,
        values:
          adapter.source === "host"
            ? hostValues(t, scale, app, visit)
            : [
                value("connections", Math.round(3 + 2 * wave(t, 4 * HOUR) + noise(t, 6)), "count"),
                value(
                  "database_size",
                  8_192_000 + Math.round((t - visit + 24 * HOUR) / 60_000) * 40,
                  "bytes"
                ),
              ],
        unavailable: [],
      })),
    });
  }
  return rows;
}
