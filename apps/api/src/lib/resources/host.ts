/**
 * A host's load, memory, uptime and disk over SFTP (#38, Q4 and Q10 of
 * docs/decisions/2026-10-11-resource-readings.md), and its CPU %, network and pm2 apps (#101).
 * Fixed `/proc` files, pm2's pid files and `statvfs`; no command runs on the host. Every line
 * parses here, and a line that does not is unavailable.
 */
import * as v from "valibot";

import { appsOf, appTicksOf, readApps } from "./apps.ts";
import type { App, AppTicks, PM2_PIDS } from "./apps.ts";
import { cpuPercentOf, cpuTicksOf, netBytesOf, netRatesOf, secondsBetween } from "./rates.ts";
import type { CpuTicks, NetBytes } from "./rates.ts";
import { merge, readParts, reasonOf, valueOr } from "./read.ts";
import type { ResourceRead } from "./read.ts";

export type Statvfs = { f_frsize: number; f_blocks: number; f_bavail: number };

/** What the host reader asks of an SFTP login. */
export type HostIo = {
  /** One file that `isHostFile` admits. */
  text(path: string): Promise<string>;
  statvfs(path: string): Promise<Statvfs>;
  /** The file names in PM2_PIDS, or none when it does not exist. */
  names(dir: typeof PM2_PIDS): Promise<string[]>;
};

/** The fixed files a reading opens, whatever the adapter's root path (Q4). */
export const HOST_FILES = [
  "/proc/loadavg",
  "/proc/meminfo",
  "/proc/uptime",
  "/proc/stat",
  "/proc/net/dev",
] as const;

/** The fixed files, a process's `stat` and `status`, and pm2's pid files; nothing else. */
export function isHostFile(path: string): boolean {
  return (
    HOST_FILES.some((file) => file === path) ||
    /^\/proc\/\d{1,9}\/(stat|status)$/.test(path) ||
    /^\.pm2\/pids\/[A-Za-z0-9._-]{1,200}\.pid$/.test(path)
  );
}

const number = v.pipe(v.string(), v.transform(Number), v.number(), v.finite());

export function loadOf(text: string): ResourceRead {
  const [one, five, fifteen] = text.trim().split(/\s+/);
  const parse = (raw: string | undefined): number | null => {
    const parsed = v.safeParse(number, raw);
    return parsed.success ? parsed.output : null;
  };
  const missing = "/proc/loadavg did not hold three load averages";
  return merge([
    valueOr("load_1m", parse(one), "load", missing),
    valueOr("load_5m", parse(five), "load", missing),
    valueOr("load_15m", parse(fifteen), "load", missing),
  ]);
}

/** `cpu0`, `cpu1` lines; the bare `cpu` line is the total. */
export function cpuCountOf(text: string): ResourceRead {
  const count = text.split("\n").filter((line) => /^cpu\d+\s/.test(line)).length;
  return valueOr("cpu_count", count === 0 ? null : count, "count", "/proc/stat listed no CPU");
}

function kilobytes(text: string, field: string): number | null {
  const match = new RegExp(`^${field}:\\s+(\\d+) kB$`, "m").exec(text);
  const parsed = v.safeParse(number, match?.[1]);
  return parsed.success ? parsed.output * 1024 : null;
}

export function memoryOf(text: string): ResourceRead {
  return merge([
    valueOr("memory_total", kilobytes(text, "MemTotal"), "bytes", "/proc/meminfo has no MemTotal"),
    valueOr(
      "memory_available",
      kilobytes(text, "MemAvailable"),
      "bytes",
      "/proc/meminfo has no MemAvailable (Linux 3.14 and later)"
    ),
    valueOr("swap_total", kilobytes(text, "SwapTotal"), "bytes", "/proc/meminfo has no SwapTotal"),
    valueOr("swap_free", kilobytes(text, "SwapFree"), "bytes", "/proc/meminfo has no SwapFree"),
  ]);
}

export function uptimeOf(text: string): ResourceRead {
  const parsed = v.safeParse(number, text.trim().split(/\s+/)[0]);
  return valueOr(
    "uptime",
    parsed.success ? Math.round(parsed.output) : null,
    "seconds",
    "/proc/uptime did not hold the seconds since boot"
  );
}

const statvfsSchema = v.object({
  f_frsize: v.pipe(v.number(), v.minValue(1)),
  f_blocks: v.pipe(v.number(), v.minValue(0)),
  f_bavail: v.pipe(v.number(), v.minValue(0)),
});

export function diskOf(stats: Statvfs): ResourceRead {
  const parsed = v.safeParse(statvfsSchema, stats);
  const missing = "the SFTP server answered statvfs without block counts";
  return merge([
    valueOr(
      "disk_total",
      parsed.success ? parsed.output.f_blocks * parsed.output.f_frsize : null,
      "bytes",
      missing
    ),
    valueOr(
      "disk_free",
      parsed.success ? parsed.output.f_bavail * parsed.output.f_frsize : null,
      "bytes",
      missing
    ),
  ]);
}

/** The counters read twice, a second apart. */
type Counters = {
  cpu: CpuTicks | null;
  net: NetBytes | null;
  apps: AppTicks;
  uptime: number | null;
};

async function textOrNull(io: HostIo, path: string): Promise<string | null> {
  try {
    return await io.text(path);
  } catch {
    return null;
  }
}

async function countersOf(io: HostIo, apps: App[]): Promise<Counters> {
  const [stat, net, ticks, uptime] = await Promise.all([
    textOrNull(io, "/proc/stat"),
    textOrNull(io, "/proc/net/dev"),
    appTicksOf(io, apps),
    textOrNull(io, "/proc/uptime"),
  ]);
  const seconds = uptime === null ? [] : uptimeOf(uptime).values;
  return {
    cpu: stat === null ? null : cpuTicksOf(stat),
    net: net === null ? null : netBytesOf(net),
    apps: ticks,
    uptime: seconds[0]?.value ?? null,
  };
}

/** Waits between the two reads; tests pass one that does not. */
export type Pause = () => Promise<void>;
const ONE_SECOND: Pause = () => Bun.sleep(1000);

async function readRates(io: HostIo, pause: Pause): Promise<ResourceRead> {
  const apps = await appsOf(io).catch((cause: unknown) => {
    throw new Error(`pm2's pid files: ${reasonOf(cause)}`);
  });
  const first = await countersOf(io, apps);
  await pause();
  const second = await countersOf(io, apps);
  const seconds =
    first.cpu !== null && second.cpu !== null ? secondsBetween(first.cpu, second.cpu) : 0;
  return merge([
    cpuPercentOf(first.cpu, second.cpu),
    netRatesOf(first.net, second.net, seconds),
    await readApps(io, apps, {
      first: first.apps,
      second: second.apps,
      seconds,
      uptime: second.uptime,
    }),
  ]);
}

export async function readHost(
  io: HostIo,
  rootPath: string,
  pause: Pause = ONE_SECOND
): Promise<ResourceRead> {
  const [fixed, rates] = await Promise.all([
    readFixed(io, rootPath),
    readParts([
      { keys: ["cpu_percent", "cpu_iowait", "net_rx", "net_tx"], read: () => readRates(io, pause) },
    ]),
  ]);
  return merge([fixed, rates]);
}

function readFixed(io: HostIo, rootPath: string): Promise<ResourceRead> {
  return readParts([
    {
      keys: ["load_1m", "load_5m", "load_15m"],
      read: async () => loadOf(await io.text("/proc/loadavg")),
    },
    { keys: ["cpu_count"], read: async () => cpuCountOf(await io.text("/proc/stat")) },
    {
      keys: ["memory_total", "memory_available", "swap_total", "swap_free"],
      read: async () => memoryOf(await io.text("/proc/meminfo")),
    },
    { keys: ["uptime"], read: async () => uptimeOf(await io.text("/proc/uptime")) },
    { keys: ["disk_total", "disk_free"], read: async () => diskOf(await io.statvfs(rootPath)) },
  ]);
}
