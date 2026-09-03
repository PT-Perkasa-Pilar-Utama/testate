import type { SQL } from "bun";
import type { Capabilities, ProbeResult } from "@testate/shared";
import * as v from "valibot";

import { selectRestoreStrategy, isRefusal } from "../pure/strategy.ts";
import { EngineError } from "../types.ts";
import { introspect } from "./introspect.ts";
import { swallow } from "./reader.ts";
import { pgArray, quoteTable } from "./pool.ts";

export const POSTGRES_FLOOR = "13";
const FLOOR_NUM = 130000;

const versionRow = v.object({ num: v.number(), text: v.string() });
const flagsRow = v.object({ superuser: v.boolean(), signal: v.boolean(), size: v.number() });

function shortVersion(text: string): string {
  return /PostgreSQL (\d+(?:\.\d+)?)/.exec(text)?.[1] ?? text;
}

/** Whether `session_replication_role = replica` may be set, learned by trying inside a rolled-back transaction. */
async function canDisableTriggers(sql: SQL): Promise<boolean> {
  const reserved = await sql.reserve();
  try {
    await reserved.unsafe("BEGIN");
    await reserved.unsafe("SET LOCAL session_replication_role = replica");
    return true;
  } catch {
    return false;
  } finally {
    await swallow(reserved.unsafe("ROLLBACK"));
    reserved.release();
  }
}

async function canTruncateAll(sql: SQL, tables: string[]): Promise<boolean> {
  if (tables.length === 0) return true;
  const rows = await sql.unsafe(
    `SELECT bool_and(has_table_privilege(current_user, t, 'TRUNCATE')) AS ok FROM unnest($1::text[]) AS t`,
    [pgArray(tables)]
  );
  return v.parse(v.object({ ok: v.nullable(v.boolean()) }), rows[0]).ok === true;
}

/** Version, privileges, sizes, and the strategy the privileges allow (12 §12.2). */
export async function probe(sql: SQL): Promise<ProbeResult> {
  const version = v.parse(
    versionRow,
    (
      await sql.unsafe(
        "SELECT current_setting('server_version_num')::int AS num, version() AS text"
      )
    )[0]
  );
  const introspection = await introspect(sql, []);
  const tables = introspection.tables.filter((table) => !table.excluded);
  const names = tables.map((table) => quoteTable(table.schema, table.name));
  const flags = v.parse(
    flagsRow,
    (
      await sql.unsafe(
        `SELECT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser,
                pg_has_role(current_user, 'pg_signal_backend', 'member') AS signal,
                COALESCE((SELECT SUM(pg_total_relation_size(c.oid)) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                          WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema')), 0)::float AS size`
      )
    )[0]
  );
  const hasDeferrable = tables.some((table) => table.foreign_keys_out.some((fk) => fk.deferrable));
  const capabilities: Capabilities = {
    canTruncate: flags.superuser || (await canTruncateAll(sql, names)),
    canDisableTriggers: flags.superuser || (await canDisableTriggers(sql)),
    canTerminateSessions: flags.superuser || flags.signal,
    supportsDeferrableConstraints: hasDeferrable,
    transactionalRestore: true,
    snapshotRead: "repeatable-read",
    timeSeriesDeletes: false,
  };
  const strategy = selectRestoreStrategy(capabilities, hasDeferrable);
  if (isRefusal(strategy)) throw new EngineError("privilege_missing", strategy.reason);
  const meetsFloor = version.num >= FLOOR_NUM;
  return {
    engine: "postgres",
    dialect: "postgres",
    version: shortVersion(version.text),
    meets_floor: meetsFloor,
    floor: POSTGRES_FLOOR,
    tier: "tabular",
    capabilities,
    strategy,
    read_only_enforcement: "transaction",
    table_count: tables.length,
    size_estimate_bytes: Math.round(flags.size),
    atomicity_notice:
      "Postgres restores as one transaction. Locks each table while it restores it.",
    warnings: introspection.warnings,
  };
}
