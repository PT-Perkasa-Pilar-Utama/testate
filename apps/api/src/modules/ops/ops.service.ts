import { accessSync, constants, statfsSync } from "node:fs";
import type { HealthAdmin } from "@testate/shared";

import type { BlobStore } from "../../lib/blobstore/index.ts";
import type { MetadataDb } from "../../lib/db/index.ts";

export type HealthDeps = {
  db: MetadataDb;
  dataDir: string;
  env: HealthAdmin["env"];
  version: string;
  bootId: string;
  bootedAt: number;
  storeDriver: "local" | "s3";
  /** Probed on every health call: a store nobody can reach loses every snapshot and checkout. */
  store: BlobStore;
  activeKid: string;
  extraKeys: number;
  sinkDegraded: () => boolean;
  dispatcher: () => { alive: boolean; running: number; queued: number; lastTickAt: string | null };
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

/** No blob can have this hash. The probe wants the round trip, not the answer. */
const ABSENT_HASH = "0".repeat(64);
const PROBE_TIMEOUT_MS = 2_000;

/** Never rejects: a probe that loses the race below would have no one left to catch it. */
async function reachable(store: BlobStore): Promise<boolean> {
  try {
    await store.has(ABSENT_HASH);
    return true;
  } catch {
    return false;
  }
}

async function tooSlow(): Promise<boolean> {
  await Bun.sleep(PROBE_TIMEOUT_MS);
  return false;
}

async function checkStore(deps: HealthDeps): Promise<HealthAdmin["checks"]["snapshot_store"]> {
  const started = performance.now();
  const answered = await Promise.race([reachable(deps.store), tooSlow()]);
  return {
    status: answered ? "ok" : "down",
    driver: deps.storeDriver,
    latency_ms: Math.round(performance.now() - started),
  };
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
export async function health(deps: HealthDeps): Promise<HealthAdmin> {
  const dispatcher = deps.dispatcher();
  const checks: HealthAdmin["checks"] = {
    metadata_db: checkDb(deps.db),
    data_dir: checkDataDir(deps.dataDir),
    snapshot_store: await checkStore(deps),
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
    checks,
  };
}
