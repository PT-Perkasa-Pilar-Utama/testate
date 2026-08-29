import type { SQL } from "bun";
import type { Capabilities, ProbeResult } from "@testate/shared";
import * as v from "valibot";

import { isRefusal, selectRestoreStrategy } from "../pure/strategy.ts";
import { EngineError } from "../types.ts";
import { introspect } from "./introspect.ts";

export const MYSQL_FLOOR = "8.0";
export const MARIADB_FLOOR = "10.6";

const versionRow = v.object({ v: v.string() });
const grantRow = v.record(v.string(), v.string());
const sizeRow = v.object({ size: v.nullable(v.union([v.number(), v.string(), v.bigint()])) });

export type Dialect = { name: "mysql" | "mariadb"; version: string; meetsFloor: boolean };

/** `8.4.11` or `11.4.13-MariaDB-ubu2404`: the suffix picks the dialect and its floor (ADR 0001). */
export function dialectOf(version: string): Dialect {
  const mariadb = /mariadb/i.test(version);
  const short = /^(\d+\.\d+)/.exec(version)?.[1] ?? version;
  const [major = 0, minor = 0] = short.split(".").map(Number);
  const meetsFloor = mariadb ? major > 10 || (major === 10 && minor >= 6) : major >= 8;
  return { name: mariadb ? "mariadb" : "mysql", version: short, meetsFloor };
}

/** `SHOW GRANTS` text: ALL PRIVILEGES or the named privilege, on *.* or this database (12 §12.2). */
export function grantsAllow(grants: string[], privilege: string): boolean {
  return grants.some(
    (line) =>
      /GRANT (ALL PRIVILEGES|ALL)\b/i.test(line) || new RegExp(`\\b${privilege}\\b`, "i").test(line)
  );
}

export async function probe(sql: SQL): Promise<ProbeResult> {
  const version = v.parse(versionRow, (await sql.unsafe("SELECT VERSION() AS v"))[0]).v;
  const dialect = dialectOf(version);
  const grants = v
    .parse(v.array(grantRow), [...(await sql.unsafe("SHOW GRANTS"))])
    .flatMap((row) => Object.values(row));
  const introspection = await introspect(sql, []);
  const tables = introspection.tables.filter((table) => !table.excluded);
  const size =
    v.parse(
      sizeRow,
      (
        await sql.unsafe(
          "SELECT SUM(DATA_LENGTH + INDEX_LENGTH) AS size FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()"
        )
      )[0]
    ).size ?? 0;
  const capabilities: Capabilities = {
    canTruncate: grantsAllow(grants, "DROP"),
    canDisableTriggers: false,
    canTerminateSessions:
      grantsAllow(grants, "SUPER") ||
      grantsAllow(grants, "CONNECTION_ADMIN") ||
      grantsAllow(grants, "PROCESS"),
    supportsDeferrableConstraints: false,
    transactionalRestore: true,
    snapshotRead: "consistent-snapshot",
    timeSeriesDeletes: false,
  };
  const strategy = selectRestoreStrategy(capabilities, false);
  if (isRefusal(strategy)) throw new EngineError("privilege_missing", strategy.reason);
  return {
    engine: dialect.name,
    dialect: dialect.name,
    version: dialect.version,
    meets_floor: dialect.meetsFloor,
    floor: dialect.name === "mariadb" ? MARIADB_FLOOR : MYSQL_FLOOR,
    tier: "tabular",
    capabilities,
    strategy: {
      ...strategy,
      emptyMode: "delete",
      foreignKeyHandling: "session-disable",
      locking: "row",
    },
    read_only_enforcement: "transaction",
    table_count: tables.length,
    size_estimate_bytes: Number(size),
    atomicity_notice:
      "Restores run in one InnoDB transaction; restored tables are locked to writers for the duration. Non-InnoDB tables restore outside it.",
    warnings: tables
      .filter((table) => table.unsupported.length > 0)
      .map((table) => ({
        code: "non_transactional",
        table: table.name,
        message: table.unsupported.join(", "),
      })),
  };
}
