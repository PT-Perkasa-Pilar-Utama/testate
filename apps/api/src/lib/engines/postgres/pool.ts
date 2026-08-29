import { SQL } from "bun";

import type { Check, Verdict } from "../../netguard/index.ts";
import { sha256 } from "../../password/index.ts";
import { EngineError } from "../types.ts";
import type { ConnectionRef, PostgresConfig } from "../types.ts";

export type Netguard = { check(input: Check): Promise<Verdict> };

export type Pool = { sql: SQL; key: string };

export type PoolManager = {
  /** The pool for a connection record; rebuilt when host, port, database, user, or password change. */
  acquire(ref: ConnectionRef): Promise<SQL>;
  evict(connectionId: string): Promise<void>;
  closeAll(): Promise<void>;
};

const MAX_CONNECTIONS = 4;
const IDLE_SECONDS = 600;

function keyOf(config: PostgresConfig): string {
  return sha256(
    `${config.host}|${config.port}|${config.database}|${config.user}|${config.password}|${config.ssl}`
  );
}

/** Opens a client against one checked address, never the name (18 §18.3). */
export async function connect(
  config: PostgresConfig,
  netguard: Netguard,
  max = MAX_CONNECTIONS
): Promise<SQL> {
  const verdict = await netguard.check({
    host: config.host,
    port: config.port,
    purpose: "database",
  });
  if (!verdict.allowed) {
    throw new EngineError(
      "unreachable",
      `${config.host}:${config.port} is blocked (${verdict.reason})`,
      { reason: verdict.reason }
    );
  }
  const address = verdict.addresses[0] ?? config.host;
  return new SQL({
    hostname: address,
    port: config.port,
    database: config.database,
    username: config.user,
    password: config.password,
    tls: config.ssl === "disable" ? false : config.ssl === "require",
    max,
    idleTimeout: IDLE_SECONDS,
    connectionTimeout: 10,
    bigint: true,
  });
}

/** One pool per connection record, keyed by `connectionId` (ADR 0001 implementation rules). */
export function createPoolManager(netguard: Netguard): PoolManager {
  const pools = new Map<string, Pool>();
  return {
    async acquire(ref) {
      if (ref.config.engine !== "postgres")
        throw new EngineError("unsupported", `${ref.config.engine} has no engine yet`);
      const key = keyOf(ref.config);
      const existing = pools.get(ref.connectionId);
      if (existing !== undefined && existing.key === key) return existing.sql;
      if (existing !== undefined) await existing.sql.close();
      const sql = await connect(ref.config, netguard);
      pools.set(ref.connectionId, { sql, key });
      return sql;
    },
    async evict(connectionId) {
      const pool = pools.get(connectionId);
      pools.delete(connectionId);
      if (pool !== undefined) await pool.sql.close();
    },
    async closeAll() {
      for (const id of Array.from(pools.keys())) await this.evict(id);
    },
  };
}

/** Double-quoted identifier; the only way Testate-generated SQL names a table or column (12 §12.8). */
/** A `text[]` literal for `unsafe` parameters; Bun sends JS arrays comma-joined, not braced. */
export function pgArray(items: string[]): string {
  return `{${items.map((item) => `"${item.replace(/(["\\])/g, "\\$1")}"`).join(",")}}`;
}

export function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export function quoteTable(schema: string | null, name: string): string {
  return schema === null ? quoteIdent(name) : `${quoteIdent(schema)}.${quoteIdent(name)}`;
}
