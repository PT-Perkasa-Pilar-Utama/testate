import type { Capabilities, ProbeResult } from "@testate/shared";
import * as v from "valibot";

import type { MongoHandle } from "./client.ts";
import { introspect } from "./introspect.ts";

export const MONGODB_FLOOR = "6.0";
const TIME_SERIES_FLOOR = 7;

const buildInfo = v.object({ version: v.string() });
const hello = v.object({ setName: v.optional(v.string()) });
const connectionStatus = v.object({
  authInfo: v.object({
    authenticatedUserRoles: v.array(v.object({ role: v.string(), db: v.string() })),
  }),
});
const dbStats = v.object({ dataSize: v.optional(v.number()) });

export type Topology = {
  version: string;
  meetsFloor: boolean;
  replicaSet: boolean;
  timeSeriesDeletes: boolean;
};

const KILL_OP_ROLES = new Set([
  "root",
  "clusterAdmin",
  "clusterManager",
  "hostManager",
  "__system",
]);
const READ_ROLES = new Set(["read", "readAnyDatabase"]);

export type Version = { major: number; minor: number; short: string };

export function parseVersion(version: string): Version {
  const short = /^(\d+\.\d+)/.exec(version)?.[1] ?? version;
  const [major = 0, minor = 0] = short.split(".").map(Number);
  return { major, minor, short };
}

/** `buildInfo` and `hello`: the version floor, the replica-set flag, and the time-series floor (12 §12.2). */
export async function topologyOf(handle: MongoHandle): Promise<Topology> {
  const admin = handle.db.admin();
  const build = v.parse(buildInfo, await admin.command({ buildInfo: 1 }));
  const greeting = v.parse(hello, await handle.db.command({ hello: 1 }));
  const { major, minor, short } = parseVersion(build.version);
  return {
    version: short,
    meetsFloor: major > 6 || (major === 6 && minor >= 0),
    replicaSet: greeting.setName !== undefined,
    timeSeriesDeletes: major >= TIME_SERIES_FLOOR,
  };
}

export async function probe(handle: MongoHandle): Promise<ProbeResult> {
  const topology = await topologyOf(handle);
  const status = v.parse(connectionStatus, await handle.db.command({ connectionStatus: 1 }));
  const roles = status.authInfo.authenticatedUserRoles.map((item) => item.role);
  const stats = v.parse(dbStats, await handle.db.command({ dbStats: 1 }));
  const introspection = await introspect(handle.db, [], topology.timeSeriesDeletes);
  const tables = introspection.tables.filter((table) => !table.excluded);
  const capabilities: Capabilities = {
    canTruncate: false,
    canDisableTriggers: false,
    canTerminateSessions: roles.some((role) => KILL_OP_ROLES.has(role)),
    supportsDeferrableConstraints: false,
    transactionalRestore: false,
    snapshotRead: topology.replicaSet ? "snapshot-read-concern" : "best-effort",
    timeSeriesDeletes: topology.timeSeriesDeletes,
  };
  const warnings: ProbeResult["warnings"] = [];
  if (!topology.replicaSet)
    warnings.push({
      code: "best_effort",
      message: "standalone MongoDB: snapshots read collections one after another",
    });
  for (const table of tables)
    for (const item of table.unsupported)
      warnings.push({ code: "time_series", table: table.name, message: item.reason });
  return {
    engine: "mongodb",
    dialect: "mongodb",
    version: topology.version,
    meets_floor: topology.meetsFloor,
    floor: MONGODB_FLOOR,
    tier: "document",
    capabilities,
    strategy: {
      emptyMode: "delete-many",
      foreignKeyHandling: "not-applicable",
      transactional: false,
      triggerDisable: false,
      locking: "per-operation",
    },
    read_only_enforcement: roles.every((role) => READ_ROLES.has(role)) ? "credential" : "filter",
    table_count: tables.length,
    size_estimate_bytes: stats.dataSize ?? 0,
    atomicity_notice:
      "Restores run per collection: deleteMany then insertMany. A failure part-way leaves earlier collections restored and later ones untouched.",
    warnings,
  };
}
