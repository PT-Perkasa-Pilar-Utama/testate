/**
 * MySQL and MariaDB server counters for a resource reading (#38). `SHOW GLOBAL STATUS` and
 * `@@max_connections` answer for the plain test user on 8.4 and 11.4, as measured.
 */
import type { SQL } from "bun";
import * as v from "valibot";

import { merge, readParts, valueOr } from "../../resources/read.ts";
import type { ResourceRead } from "../../resources/read.ts";
import type { ResourceUnit } from "@testate/shared";

/** Counters come back as numbers, strings or BigInts depending on their size and the driver. */
const counter = v.pipe(
  v.union([v.number(), v.string(), v.bigint()]),
  v.transform(Number),
  v.number(),
  v.finite()
);
const statusRow = v.object({
  Variable_name: v.string(),
  Value: v.union([v.string(), v.number(), v.bigint()]),
});

const STATUS: [string, string, ResourceUnit][] = [
  ["Threads_connected", "connections", "count"],
  ["Threads_running", "active_connections", "count"],
  ["Max_used_connections", "max_used_connections", "count"],
  ["Questions", "questions", "count"],
  ["Slow_queries", "slow_queries", "count"],
  ["Uptime", "uptime", "seconds"],
];

async function status(sql: SQL): Promise<ResourceRead> {
  const names = STATUS.map(([name]) => `'${name}'`).join(",");
  const rows = v.parse(v.array(statusRow), [
    ...(await sql.unsafe(`SHOW GLOBAL STATUS WHERE Variable_name IN (${names})`)),
  ]);
  const byName = new Map(rows.map((item) => [item.Variable_name, item.Value]));
  return merge(
    STATUS.map(([name, key, unit]) => {
      const parsed = v.safeParse(counter, byName.get(name));
      return valueOr(key, parsed.success ? parsed.output : null, unit, `the server has no ${name}`);
    })
  );
}

async function limits(sql: SQL): Promise<ResourceRead> {
  const rows = await sql.unsafe(
    `SELECT @@max_connections AS max_connections,
            (SELECT COALESCE(SUM(data_length + index_length), 0) FROM information_schema.tables
              WHERE table_schema = DATABASE()) AS size`
  );
  const found = v.parse(v.object({ max_connections: counter, size: v.nullable(counter) }), rows[0]);
  return merge([
    valueOr("max_connections", found.max_connections, "count", "no max_connections"),
    valueOr("database_size", found.size, "bytes", "no database is selected"),
  ]);
}

export function readResources(sql: SQL): Promise<ResourceRead> {
  return readParts([
    { keys: STATUS.map(([, key]) => key), read: () => status(sql) },
    { keys: ["max_connections", "database_size"], read: () => limits(sql) },
  ]);
}
