/**
 * PostgreSQL server counters for a resource reading (#38; Q11 of
 * docs/decisions/2026-10-11-resource-readings.md). Every query here answers for a plain login role,
 * as measured; only the per-state session count needs `pg_read_all_stats`.
 */
import type { SQL } from "bun";
import * as v from "valibot";

import { merge, readParts, valueOr } from "../../resources/read.ts";
import type { ResourceRead } from "../../resources/read.ts";

const num = v.nullable(v.number());
const READ_ALL_STATS = "needs the pg_read_all_stats role to see other sessions' state";

async function row<T extends v.GenericSchema>(
  sql: SQL,
  schema: T,
  query: string
): Promise<v.InferOutput<T>> {
  const rows = await sql.unsafe(query);
  return v.parse(schema, rows[0]);
}

const connections = v.object({ connections: num, max_connections: num, may_read_all: v.boolean() });
const database = v.object({
  commits: num,
  rollbacks: num,
  deadlocks: num,
  blocks_hit: num,
  blocks_read: num,
  size: num,
  uptime: num,
});

async function sessions(sql: SQL): Promise<ResourceRead> {
  const found = await row(
    sql,
    connections,
    `SELECT (SELECT count(*) FROM pg_stat_activity)::float8 AS connections,
            current_setting('max_connections')::float8 AS max_connections,
            (pg_has_role(current_user, 'pg_read_all_stats', 'MEMBER')
              OR (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)) AS may_read_all`
  );
  const active = found.may_read_all
    ? (
        await row(
          sql,
          v.object({ active: num }),
          "SELECT count(*)::float8 AS active FROM pg_stat_activity WHERE state = 'active'"
        )
      ).active
    : null;
  return merge([
    valueOr("connections", found.connections, "count", "pg_stat_activity answered no count"),
    valueOr("max_connections", found.max_connections, "count", "no max_connections setting"),
    valueOr("active_connections", active, "count", READ_ALL_STATS),
  ]);
}

async function counters(sql: SQL): Promise<ResourceRead> {
  const found = await row(
    sql,
    database,
    `SELECT xact_commit::float8 AS commits, xact_rollback::float8 AS rollbacks,
            deadlocks::float8 AS deadlocks, blks_hit::float8 AS blocks_hit,
            blks_read::float8 AS blocks_read,
            pg_database_size(current_database())::float8 AS size,
            extract(epoch FROM now() - pg_postmaster_start_time())::float8 AS uptime
     FROM pg_stat_database WHERE datname = current_database()`
  );
  const touched = (found.blocks_hit ?? 0) + (found.blocks_read ?? 0);
  const missing = "pg_stat_database has no row for this database";
  return merge([
    valueOr("database_size", found.size, "bytes", missing),
    valueOr("commits", found.commits, "count", missing),
    valueOr("rollbacks", found.rollbacks, "count", missing),
    valueOr("deadlocks", found.deadlocks, "count", missing),
    valueOr(
      "cache_hit_ratio",
      touched === 0 ? null : (found.blocks_hit ?? 0) / touched,
      "ratio",
      "no block has been read yet"
    ),
    valueOr("uptime", found.uptime === null ? null : Math.round(found.uptime), "seconds", missing),
  ]);
}

export function readResources(sql: SQL): Promise<ResourceRead> {
  return readParts([
    { keys: ["connections", "max_connections", "active_connections"], read: () => sessions(sql) },
    {
      keys: ["database_size", "commits", "rollbacks", "deadlocks", "cache_hit_ratio", "uptime"],
      read: () => counters(sql),
    },
  ]);
}
