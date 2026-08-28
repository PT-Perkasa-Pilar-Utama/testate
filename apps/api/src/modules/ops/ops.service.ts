import { accessSync, constants, statfsSync } from "node:fs";
import type { HealthAdmin } from "@testate/shared";

import type { MetadataDb } from "../../lib/db/index.ts";

export type HealthDeps = {
  db: MetadataDb;
  dataDir: string;
  env: HealthAdmin["env"];
  version: string;
  bootId: string;
  bootedAt: number;
  storeDriver: "local" | "s3";
  activeKid: string;
  extraKeys: number;
  sinkDegraded: () => boolean;
  dispatcher: () => { alive: boolean; running: number; queued: number; lastTickAt: string | null };
  originShared: boolean;
};

type CheckStatus = HealthAdmin["status"];

function checkDb(db: MetadataDb): HealthAdmin["checks"]["metadata_db"] {
  const started = performance.now();
  try {
    db.query("SELECT 1").get();
    return { status: "ok", latency_ms: Math.round(performance.now() - started) };
  } catch {
    return { status: "down", latency_ms: Math.round(performance.now() - started) };
  }
}

function checkDataDir(dir: string): HealthAdmin["checks"]["data_dir"] {
  try {
    accessSync(dir, constants.W_OK);
    const stats = statfsSync(dir);
    return { status: "ok", free_bytes: Number(stats.bavail) * Number(stats.bsize) };
  } catch {
    return { status: "down", free_bytes: 0 };
  }
}

function overall(checks: HealthAdmin["checks"]): CheckStatus {
  if (checks.metadata_db.status === "down" || checks.data_dir.status === "down") return "down";
  const degraded = [
    checks.snapshot_store,
    checks.dispatcher,
    checks.log_sink,
    checks.sealed_keys,
  ].some((check) => check.status !== "ok");
  return degraded ? "degraded" : "ok";
}

/** The admin health breakdown; the public shape is its `status` alone. */
export function health(deps: HealthDeps): HealthAdmin {
  const dispatcher = deps.dispatcher();
  const checks: HealthAdmin["checks"] = {
    metadata_db: checkDb(deps.db),
    data_dir: checkDataDir(deps.dataDir),
    snapshot_store: { status: "ok", driver: deps.storeDriver, latency_ms: 0 },
    dispatcher: {
      status: dispatcher.alive ? "ok" : "degraded",
      running: dispatcher.running,
      queued: dispatcher.queued,
      last_tick_at: dispatcher.lastTickAt,
    },
    log_sink: { status: deps.sinkDegraded() ? "degraded" : "ok" },
    sealed_keys: { status: "ok", active_fingerprint: deps.activeKid, extra_values: deps.extraKeys },
  };
  return {
    status: overall(checks),
    version: deps.version,
    boot_id: deps.bootId,
    uptime_s: Math.round((Date.now() - deps.bootedAt) / 1000),
    env: deps.env,
    origin_shared: deps.originShared,
    checks,
  };
}
