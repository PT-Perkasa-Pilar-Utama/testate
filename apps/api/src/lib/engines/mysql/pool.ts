import { SQL } from "bun";

import { sha256 } from "../../password/index.ts";
import { EngineError } from "../types.ts";
import type { ConnectionRef, MysqlConfig } from "../types.ts";
import type { Netguard, PoolManager } from "../postgres/pool.ts";

const MAX_CONNECTIONS = 4;
const IDLE_SECONDS = 600;

function keyOf(config: MysqlConfig): string {
  return sha256(
    `${config.host}|${config.port}|${config.database}|${config.user}|${config.password}|${config.ssl}`
  );
}

/** Opens a client against one checked address; `caching_sha2_password` needs the public key over plain TCP. */
export async function connect(
  config: MysqlConfig,
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
  const options = {
    adapter: "mysql",
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
    allowPublicKeyRetrieval: true,
  };
  // SAFETY: `allowPublicKeyRetrieval` is a documented Bun MySQL option missing from the bundled types.
  return new SQL(options as ConstructorParameters<typeof SQL>[0]);
}

export function createMysqlPoolManager(netguard: Netguard): PoolManager {
  const pools = new Map<string, { sql: SQL; key: string }>();
  return {
    async acquire(ref: ConnectionRef) {
      if (ref.config.engine !== "mysql" && ref.config.engine !== "mariadb")
        throw new EngineError("unsupported", `${ref.config.engine} config on the mysql engine`);
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

/** Backtick-quoted identifier; the only way Testate-generated SQL names a table or column on MySQL. */
export function quoteIdent(name: string): string {
  return `\`${name.replaceAll("`", "``")}\``;
}
