import { describe, expect, it } from "bun:test";
import { MongoClient } from "mongodb";

import type { Netguard } from "../postgres/pool.ts";
import type { ConnectionRef, MongodbConfig } from "../types.ts";
import { createMongodbEngine } from "./engine.ts";

/**
 * A checkout or a snapshot ends by evicting the adapter's client. A browse running beside it on
 * the same client used to die with "client was closed" (seen in the e2e suite); a retired client
 * now closes only once its last operation lets go. Against `deploy/compose.engines.yml`.
 */
const CONFIG: MongodbConfig = {
  engine: "mongodb",
  host: "127.0.0.1",
  port: 17017,
  database: "shop",
  user: "testate",
  password: "testate",
  ssl: "disable",
  authSource: "admin",
};
const URL = `mongodb://testate:testate@127.0.0.1:17017/shop?authSource=admin&directConnection=true`;
const netguard: Netguard = { check: async () => ({ allowed: true, addresses: ["127.0.0.1"] }) };

async function reachable(): Promise<boolean> {
  const client = new MongoClient(URL, { serverSelectionTimeoutMS: 2000 });
  try {
    await client.connect();
    await client.db().command({ ping: 1 });
    return true;
  } catch {
    return false;
  } finally {
    await client.close();
  }
}

/** "ok", or the message the operation failed with. */
async function outcomeOf(operation: Promise<unknown>): Promise<string> {
  try {
    await operation;
    return "ok";
  } catch (cause: unknown) {
    return cause instanceof Error ? cause.message : String(cause);
  }
}

describe.skipIf(!(await reachable()))(
  "mongodb engine: evict beside a running read (contract)",
  () => {
    it("lets every introspect finish while the client is evicted under it", async () => {
      const engine = createMongodbEngine(netguard);
      const conn: ConnectionRef = { connectionId: "contract-mongodb-evict", config: CONFIG };
      await engine.introspect(conn, []);
      const outcomes: string[] = [];
      for (let delay = 0; delay < 20; delay += 1) {
        const reading = outcomeOf(engine.introspect(conn, []));
        await Bun.sleep(delay);
        await engine.evict(conn.connectionId);
        outcomes.push(await reading);
      }
      await engine.evict(conn.connectionId);
      expect(outcomes.filter((outcome) => outcome !== "ok")).toEqual([]);
    });
  }
);
