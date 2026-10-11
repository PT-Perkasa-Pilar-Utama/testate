import { afterAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { MongoClient } from "mongodb";

import type { ResourceRead } from "../resources/read.ts";
import { createMongodbEngine } from "./mongodb/engine.ts";
import { createMysqlEngine } from "./mysql/engine.ts";
import { CONFIG as PG, URL as PG_URL, netguard } from "./postgres/postgres.contract.support.ts";
import { createPostgresEngine } from "./postgres/engine.ts";
import type { ConnectionConfig } from "./types.ts";

/**
 * Resource readings against `deploy/compose.engines.yml` (#38): each engine answers its counters
 * for the compose user, and a login without the monitoring grant gets the grant named instead of
 * a failed reading (Q11). Each block is skipped when its server is not up.
 */
const keys = (read: ResourceRead): string[] => read.values.map((item) => item.key).sort();
const gap = (read: ResourceRead, key: string): string | undefined =>
  read.unavailable.find((item) => item.key === key)?.reason;

async function up(probe: () => Promise<void>): Promise<boolean> {
  try {
    await probe();
    return true;
  } catch {
    return false;
  }
}

function clientFor(url: string): SQL {
  if (!url.startsWith("mysql:")) return new SQL(url);
  // SAFETY: `allowPublicKeyRetrieval` is a documented Bun MySQL option missing from the bundled
  // types; MySQL 8's default login needs it over a plain connection, as mysql.contract.test.ts does.
  return new SQL({ url, allowPublicKeyRetrieval: true } as ConstructorParameters<typeof SQL>[0]);
}

const pgUp = await up(async () => {
  const sql = new SQL(PG_URL);
  await sql.unsafe("SELECT 1");
  await sql.close();
});
describe.skipIf(!pgUp)("postgres resources (contract)", () => {
  const engine = createPostgresEngine(netguard);
  const ROLE = `res_${Date.now()}`;
  afterAll(async () => {
    await engine.evict("res-postgres");
    await engine.evict("res-postgres-plain");
    const admin = new SQL(PG_URL);
    await admin.unsafe(`REVOKE CONNECT ON DATABASE ${PG.database} FROM ${ROLE}`).catch(() => []);
    await admin.unsafe(`DROP ROLE IF EXISTS ${ROLE}`);
    await admin.close();
  });

  test("answers every counter for the compose superuser", async () => {
    const read = await engine.readResources({ connectionId: "res-postgres", config: PG });
    expect(keys(read)).toEqual([
      "active_connections",
      "cache_hit_ratio",
      "commits",
      "connections",
      "database_size",
      "deadlocks",
      "max_connections",
      "rollbacks",
      "uptime",
    ]);
  });

  test("names pg_read_all_stats for a plain role instead of undercounting", async () => {
    const admin = new SQL(PG_URL);
    await admin.unsafe(`CREATE ROLE ${ROLE} LOGIN PASSWORD 'res-pass'`);
    await admin.unsafe(`GRANT CONNECT ON DATABASE ${PG.database} TO ${ROLE}`);
    await admin.close();
    const plain: ConnectionConfig = { ...PG, user: ROLE, password: "res-pass" };
    const read = await engine.readResources({ connectionId: "res-postgres-plain", config: plain });
    expect([keys(read).includes("connections"), gap(read, "active_connections")]).toEqual([
      true,
      "needs the pg_read_all_stats role to see other sessions' state",
    ]);
  });
});

for (const [name, port] of [
  ["mysql", 13306],
  ["mariadb", 13307],
] as const) {
  const url = `mysql://testate:testate@127.0.0.1:${port}/shop`;
  const isUp = await up(async () => {
    const sql = clientFor(url);
    await sql.unsafe("SELECT 1");
    await sql.close();
  });
  describe.skipIf(!isUp)(`${name} resources (contract)`, () => {
    const engine = createMysqlEngine(netguard);
    afterAll(() => engine.evict(`res-${name}`));
    test("answers its status counters for the plain compose user", async () => {
      const config: ConnectionConfig = {
        engine: name,
        host: "127.0.0.1",
        port,
        database: "shop",
        user: "testate",
        password: "testate",
        ssl: "disable",
      };
      const read = await engine.readResources({ connectionId: `res-${name}`, config });
      expect(keys(read)).toEqual([
        "active_connections",
        "connections",
        "database_size",
        "max_connections",
        "max_used_connections",
        "questions",
        "slow_queries",
        "uptime",
      ]);
    });
  });
}

const MONGO: ConnectionConfig = {
  engine: "mongodb",
  host: "127.0.0.1",
  port: 17017,
  database: "shop",
  user: "testate",
  password: "testate",
  ssl: "disable",
  authSource: "admin",
};
const mongoUrl =
  "mongodb://testate:testate@127.0.0.1:17017/shop?authSource=admin&directConnection=true";
const mongoUp = await up(async () => {
  const client = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: 2000 });
  await client.connect();
  await client.close();
});
describe.skipIf(!mongoUp)("mongodb resources (contract)", () => {
  const engine = createMongodbEngine(netguard);
  const USER = `res_${Date.now()}`;
  afterAll(async () => {
    await engine.evict("res-mongodb");
    await engine.evict("res-mongodb-plain");
    const client = new MongoClient(mongoUrl);
    await client
      .db("shop")
      .command({ dropUser: USER })
      .catch(() => null);
    await client.close();
  });

  test("answers database and server counters for the compose root user", async () => {
    const read = await engine.readResources({ connectionId: "res-mongodb", config: MONGO });
    expect([keys(read).includes("data_size"), keys(read).includes("resident_memory")]).toEqual([
      true,
      true,
    ]);
  });

  test("names clusterMonitor for a readWrite user, and still reads dbStats", async () => {
    const client = new MongoClient(mongoUrl);
    await client
      .db("shop")
      .command({ createUser: USER, pwd: "res-pass", roles: [{ role: "readWrite", db: "shop" }] });
    await client.close();
    const plain: ConnectionConfig = {
      ...MONGO,
      user: USER,
      password: "res-pass",
      authSource: "shop",
    };
    const read = await engine.readResources({ connectionId: "res-mongodb-plain", config: plain });
    expect([keys(read).includes("data_size"), gap(read, "connections")]).toEqual([
      true,
      "needs the clusterMonitor role",
    ]);
  });
});
