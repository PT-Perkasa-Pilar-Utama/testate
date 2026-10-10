import { afterAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { MongoClient } from "mongodb";
import type { ServerLogSource } from "@testate/shared";

import { createMongodbEngine } from "./mongodb/engine.ts";
import { createMysqlEngine } from "./mysql/engine.ts";
import { CONFIG as PG, URL as PG_URL, netguard } from "./postgres/postgres.contract.support.ts";
import { createPostgresEngine } from "./postgres/engine.ts";
import type { ConnectionConfig, DbEngine } from "./types.ts";

/**
 * Server logs against `deploy/compose.engines.yml` (#84): each engine's probe lists what the
 * compose user can read, and its statements show one this test just ran elsewhere. Each block is
 * skipped when its server is not up.
 */
const MARKER = `srvlog_${Date.now()}`;

const MYSQL = (engine: "mysql" | "mariadb", port: number): ConnectionConfig => ({
  engine,
  host: "127.0.0.1",
  port,
  database: "shop",
  user: "testate",
  password: "testate",
  ssl: "disable",
});
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

async function up(probe: () => Promise<void>): Promise<boolean> {
  try {
    await probe();
    return true;
  } catch {
    return false;
  }
}

/** A client of its own, so the marker is another session's statement. */
function clientFor(url: string): SQL {
  if (!url.startsWith("mysql:")) return new SQL(url);
  // SAFETY: `allowPublicKeyRetrieval` is a documented Bun MySQL option missing from the bundled
  // types; MySQL 8's default login needs it over a plain connection, as mysql.contract.test.ts does.
  return new SQL({ url, allowPublicKeyRetrieval: true } as ConstructorParameters<typeof SQL>[0]);
}

async function sqlClient(url: string): Promise<SQL> {
  const sql = clientFor(url);
  await sql.unsafe(`SELECT '${MARKER}' AS marker`);
  return sql;
}

async function sourcesAndMarker(
  engine: DbEngine,
  config: ConnectionConfig
): Promise<{ sources: ServerLogSource[]; seen: boolean }> {
  const conn = { connectionId: `serverlog-${config.engine}`, config };
  const probe = await engine.probe(config);
  const sources = probe.capabilities.serverLogs;
  const read = sources.includes("statements")
    ? await engine.readServerLog(conn, "statements", { limit: 200, before: null, after: null })
    : { entries: [] };
  return { sources, seen: read.entries.some((entry) => entry.message.includes(MARKER)) };
}

const pgUp = await up(async () => {
  const sql = new SQL(PG_URL);
  await sql.unsafe("SELECT 1");
  await sql.close();
});
describe.skipIf(!pgUp)("postgres server logs (contract)", () => {
  const engine = createPostgresEngine(netguard);
  afterAll(() => engine.evict("serverlog-postgres"));
  test("lists statements and shows another session's latest one", async () => {
    const other = await sqlClient(PG_URL);
    try {
      const { sources, seen } = await sourcesAndMarker(engine, PG);
      expect([sources.includes("statements"), seen]).toEqual([true, true]);
    } finally {
      await other.close();
    }
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
  describe.skipIf(!isUp)(`${name} server logs (contract)`, () => {
    const engine = createMysqlEngine(netguard);
    afterAll(() => engine.evict(`serverlog-${name}`));
    test("with the performance_schema grant, lists statements and shows another session's", async () => {
      // As root, the grant D3 tells a person to run: the compose user has none by default.
      const root = clientFor(`mysql://root:testate@127.0.0.1:${port}/shop`);
      await root.unsafe("GRANT SELECT ON performance_schema.* TO 'testate'@'%'");
      await root.close();
      const other = await sqlClient(url);
      try {
        const { sources, seen } = await sourcesAndMarker(engine, MYSQL(name, port));
        expect([sources.includes("statements"), seen]).toEqual([true, true]);
      } finally {
        await other.close();
      }
    });
  });
}

const mongoUrl =
  "mongodb://testate:testate@127.0.0.1:17017/shop?authSource=admin&directConnection=true";
const mongoUp = await up(async () => {
  const client = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: 2000 });
  await client.connect();
  await client.close();
});
describe.skipIf(!mongoUp)("mongodb server logs (contract)", () => {
  const engine = createMongodbEngine(netguard);
  afterAll(() => engine.evict("serverlog-mongodb"));
  test("lists the server log and reads its newest lines", async () => {
    const conn = { connectionId: "serverlog-mongodb", config: MONGO };
    const probe = await engine.probe(MONGO);
    const log = await engine.readServerLog(conn, "server-log", {
      limit: 5,
      before: null,
      after: null,
    });
    expect([probe.capabilities.serverLogs.includes("server-log"), log.entries.length > 0]).toEqual([
      true,
      true,
    ]);
  });
});
