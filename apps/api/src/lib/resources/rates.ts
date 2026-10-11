/**
 * What needs two reads of a counter (#101, docs/decisions/2026-10-11-monitor.md): CPU %, network
 * throughput and each pm2 app's CPU. A reading reads the counters, waits about a second, and
 * reads them again, so the poller keeps nothing between ticks. Elapsed time comes from the
 * kernel's own CPU tick total, not the wall clock, so SFTP latency cannot skew a rate.
 */
import * as v from "valibot";

import { merge, valueOr } from "./read.ts";
import type { ResourceRead } from "./read.ts";

/** USER_HZ. ponytail: 100 on every mainstream Linux build; read `getconf CLK_TCK` if one differs. */
export const TICKS_PER_SECOND = 100;

const counter = v.pipe(v.string(), v.transform(Number), v.number(), v.finite(), v.minValue(0));

const counters = (fields: readonly string[]): number[] | null => {
  const parsed = v.safeParse(v.array(counter), fields);
  return parsed.success ? parsed.output : null;
};

/** The `cpu` line of `/proc/stat`: every tick so far, the idle ones, and the CPU count. */
export type CpuTicks = { total: number; idle: number; iowait: number; cpus: number };

export function cpuTicksOf(text: string): CpuTicks | null {
  const line = text.split("\n").find((row) => /^cpu\s/.test(row));
  const values = counters(line?.trim().split(/\s+/).slice(1) ?? []);
  const cpus = text.split("\n").filter((row) => /^cpu\d+\s/.test(row)).length;
  if (values === null || values.length < 5 || cpus === 0) return null;
  const total = values.slice(0, 8).reduce((sum, value) => sum + value, 0);
  return { total, idle: values[3] ?? 0, iowait: values[4] ?? 0, cpus };
}

/** Seconds between two reads, by the kernel's clock: ticks over every CPU, per CPU. */
export function secondsBetween(first: CpuTicks, second: CpuTicks): number {
  return (second.total - first.total) / second.cpus / TICKS_PER_SECOND;
}

export function cpuPercentOf(first: CpuTicks | null, second: CpuTicks | null): ResourceRead {
  const spent = first !== null && second !== null ? second.total - first.total : 0;
  const missing = "/proc/stat did not move between two reads";
  const share = (part: number | undefined): number | null =>
    spent > 0 && part !== undefined ? Math.round((part / spent) * 1000) / 10 : null;
  const idle =
    first !== null && second !== null
      ? second.idle + second.iowait - first.idle - first.iowait
      : undefined;
  const iowait = first !== null && second !== null ? second.iowait - first.iowait : undefined;
  return merge([
    valueOr(
      "cpu_percent",
      share(idle === undefined ? undefined : spent - idle),
      "percent",
      missing
    ),
    valueOr("cpu_iowait", share(iowait), "percent", missing),
  ]);
}

/** Bytes received and sent across every interface but loopback, from `/proc/net/dev`. */
export type NetBytes = { rx: number; tx: number };

export function netBytesOf(text: string): NetBytes | null {
  let rx = 0;
  let tx = 0;
  let seen = 0;
  for (const line of text.split("\n")) {
    const match = /^\s*([^:\s]+):\s*(.*)$/.exec(line);
    if (match === null || match[1] === "lo") continue;
    const fields = counters((match[2] ?? "").trim().split(/\s+/));
    if (fields === null || fields.length < 9) continue;
    rx += fields[0] ?? 0;
    tx += fields[8] ?? 0;
    seen += 1;
  }
  return seen === 0 ? null : { rx, tx };
}

export function netRatesOf(
  first: NetBytes | null,
  second: NetBytes | null,
  seconds: number
): ResourceRead {
  const ok = first !== null && second !== null && seconds > 0;
  const rate = (from: number | undefined, to: number | undefined): number | null =>
    ok && from !== undefined && to !== undefined && to >= from
      ? Math.round((to - from) / seconds)
      : null;
  const missing = "/proc/net/dev listed no interface but loopback";
  return merge([
    valueOr("net_rx", rate(first?.rx, second?.rx), "bytes_per_second", missing),
    valueOr("net_tx", rate(first?.tx, second?.tx), "bytes_per_second", missing),
  ]);
}

/** `/proc/<pid>/stat` after the command name: CPU ticks spent, and ticks since boot at start. */
export type ProcessTicks = { spent: number; startedAt: number };

export function processTicksOf(text: string): ProcessTicks | null {
  // The command name sits in parentheses and may hold spaces or `)`, so split after the last one.
  const rest = text
    .slice(text.lastIndexOf(")") + 2)
    .trim()
    .split(/\s+/);
  // `rest[0]` is field 3 (state); utime is field 14, stime 15, starttime 22.
  const fields = counters([rest[11] ?? "", rest[12] ?? "", rest[19] ?? ""]);
  if (fields === null) return null;
  return { spent: (fields[0] ?? 0) + (fields[1] ?? 0), startedAt: fields[2] ?? 0 };
}

/** Resident memory from `/proc/<pid>/status`, in bytes. */
export function residentOf(text: string): number | null {
  const parsed = v.safeParse(counter, /^VmRSS:\s+(\d+) kB$/m.exec(text)?.[1]);
  return parsed.success ? parsed.output * 1024 : null;
}

/** pm2 names a pid file `<app>-<id>.pid`; the key keeps both, in the key's alphabet. */
export function appKeyOf(file: string): string | null {
  const stem = file
    .replace(/\.pid$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
  const key = stem.replace(/^_+|_+$/g, "").slice(0, 48);
  return /^[a-z]/.test(key) ? key : null;
}
