/**
 * A host's load, memory, uptime and disk over SFTP (#38, Q4 and Q10 of
 * docs/decisions/2026-10-11-resource-readings.md). Four fixed `/proc` files and `statvfs`; no
 * command runs on the host. Every line parses here, and a line that does not is unavailable.
 */
import * as v from "valibot";

import { merge, readParts, valueOr } from "./read.ts";
import type { ResourceRead } from "./read.ts";

export type Statvfs = { f_frsize: number; f_blocks: number; f_bavail: number };

/** The two things the host reader asks of an SFTP login. */
export type HostIo = {
  text(path: string): Promise<string>;
  statvfs(path: string): Promise<Statvfs>;
};

/** The only files a reading opens, whatever the adapter's root path (Q4). */
export const HOST_FILES = ["/proc/loadavg", "/proc/meminfo", "/proc/uptime", "/proc/stat"] as const;

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

export function readHost(io: HostIo, rootPath: string): Promise<ResourceRead> {
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
