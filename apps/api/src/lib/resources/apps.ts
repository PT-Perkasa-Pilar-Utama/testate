/**
 * The pm2 apps on a host (#101, docs/decisions/2026-10-11-monitor.md): pm2 writes one pid file per
 * app under the login's `~/.pm2/pids`, and `/proc/<pid>` holds the rest. No command runs; `pm2
 * jlist` would be one. `/proc` has no restart count, so a restart shows as the uptime dropping.
 */
import * as v from "valibot";

import type { HostIo } from "./host.ts";
import { appKeyOf, processTicksOf, residentOf, TICKS_PER_SECOND } from "./rates.ts";
import type { ProcessTicks } from "./rates.ts";
import { EMPTY_READ, merge, reasonOf, valueOr } from "./read.ts";
import type { ResourceRead } from "./read.ts";

/** Relative, so the SFTP server resolves it against the login's home directory. */
export const PM2_PIDS = ".pm2/pids";
/** ponytail: the first 20 apps by file name; page them if a host runs more. */
const APPS_MAX = 20;

export type App = { key: string; pid: number };
/** One read of every app's CPU ticks; null when its process is gone. */
export type AppTicks = Map<string, ProcessTicks | null>;

const pidSchema = v.pipe(
  v.string(),
  v.trim(),
  v.regex(/^\d{1,9}$/),
  v.transform(Number),
  v.minValue(1)
);

export async function appsOf(io: HostIo): Promise<App[]> {
  const files = (await io.names(PM2_PIDS)).filter((name) => name.endsWith(".pid")).sort();
  const apps = await Promise.all(
    files.slice(0, APPS_MAX).map(async (file): Promise<App | null> => {
      const key = appKeyOf(file);
      const pid = v.safeParse(pidSchema, await io.text(`${PM2_PIDS}/${file}`).catch(() => ""));
      return key === null || !pid.success ? null : { key, pid: pid.output };
    })
  );
  return apps.filter((app) => app !== null);
}

export async function appTicksOf(io: HostIo, apps: App[]): Promise<AppTicks> {
  const read = await Promise.all(
    apps.map(async (app): Promise<[string, ProcessTicks | null]> => {
      const text = await io.text(`/proc/${app.pid}/stat`).catch(() => null);
      return [app.key, text === null ? null : processTicksOf(text)];
    })
  );
  return new Map(read);
}

const KEYS = ["cpu", "memory", "uptime"] as const;

function gone(app: App, reason: string): ResourceRead {
  return {
    values: [],
    unavailable: KEYS.map((key) => ({ key: `app_${app.key}_${key}`, reason })),
  };
}

type AppWindow = { first: AppTicks; second: AppTicks; seconds: number; uptime: number | null };

async function readApp(io: HostIo, app: App, window: AppWindow): Promise<ResourceRead> {
  const first = window.first.get(app.key);
  const second = window.second.get(app.key);
  if (first === null || first === undefined || second === null || second === undefined)
    return gone(app, `pm2 lists pid ${app.pid}, which is not running`);
  const status = await io.text(`/proc/${app.pid}/status`);
  const cpu =
    window.seconds > 0 && second.spent >= first.spent
      ? Math.round(((second.spent - first.spent) / TICKS_PER_SECOND / window.seconds) * 1000) / 10
      : null;
  const uptime =
    window.uptime === null ? null : Math.round(window.uptime - second.startedAt / TICKS_PER_SECOND);
  return merge([
    valueOr(`app_${app.key}_cpu`, cpu, "percent", "/proc/stat did not move between two reads"),
    valueOr(`app_${app.key}_memory`, residentOf(status), "bytes", "no VmRSS in its status"),
    valueOr(`app_${app.key}_uptime`, uptime, "seconds", "/proc/uptime could not be read"),
  ]);
}

export async function readApps(io: HostIo, apps: App[], window: AppWindow): Promise<ResourceRead> {
  if (apps.length === 0) return EMPTY_READ;
  const reads = await Promise.all(
    apps.map((app) => readApp(io, app, window).catch((cause) => gone(app, reasonOf(cause))))
  );
  return merge(reads);
}
