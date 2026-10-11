/**
 * MongoDB counters for a resource reading (#38; Q11). `dbStats` answers for a `readWrite` user;
 * `serverStatus` needs `clusterMonitor`, as measured on 7, and says so when refused.
 */
import * as v from "valibot";

import { merge, readParts, valueOr } from "../../resources/read.ts";
import type { ResourceRead } from "../../resources/read.ts";
import type { MongoHandle } from "./client.ts";

const num = v.optional(v.pipe(v.union([v.number(), v.bigint()]), v.transform(Number), v.number()));

const dbStats = v.object({
  objects: num,
  dataSize: num,
  storageSize: num,
  indexSize: num,
  collections: num,
});
const serverStatus = v.object({
  uptime: num,
  connections: v.optional(v.object({ current: num, available: num, active: num })),
  mem: v.optional(v.object({ resident: num })),
});

const MONITOR = "needs the clusterMonitor role";
const UNAUTHORIZED = 13;

async function database(handle: MongoHandle): Promise<ResourceRead> {
  const found = v.parse(dbStats, await handle.db.command({ dbStats: 1, scale: 1 }));
  const missing = "dbStats did not answer it";
  return merge([
    valueOr("collections", found.collections, "count", missing),
    valueOr("documents", found.objects, "count", missing),
    valueOr("data_size", found.dataSize, "bytes", missing),
    valueOr("storage_size", found.storageSize, "bytes", missing),
    valueOr("index_size", found.indexSize, "bytes", missing),
  ]);
}

const SERVER_KEYS = [
  "connections",
  "available_connections",
  "active_connections",
  "resident_memory",
  "uptime",
];

async function server(handle: MongoHandle): Promise<ResourceRead> {
  let raw;
  try {
    raw = await handle.db.admin().command({ serverStatus: 1 });
  } catch (cause: unknown) {
    const refused = v.safeParse(v.object({ code: v.literal(UNAUTHORIZED) }), cause);
    if (!refused.success) throw cause;
    return { values: [], unavailable: SERVER_KEYS.map((key) => ({ key, reason: MONITOR })) };
  }
  const found = v.parse(serverStatus, raw);
  const missing = "serverStatus did not answer it";
  const resident = found.mem?.resident;
  return merge([
    valueOr("connections", found.connections?.current, "count", missing),
    valueOr("available_connections", found.connections?.available, "count", missing),
    valueOr("active_connections", found.connections?.active, "count", missing),
    // serverStatus reports resident memory in MiB.
    valueOr(
      "resident_memory",
      resident === undefined ? null : resident * 1024 * 1024,
      "bytes",
      missing
    ),
    valueOr("uptime", found.uptime, "seconds", missing),
  ]);
}

export function readResources(handle: MongoHandle): Promise<ResourceRead> {
  return readParts([
    {
      keys: ["collections", "documents", "data_size", "storage_size", "index_size"],
      read: () => database(handle),
    },
    { keys: SERVER_KEYS, read: () => server(handle) },
  ]);
}
