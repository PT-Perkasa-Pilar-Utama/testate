import { expect, test } from "bun:test";

import { createMongodbEngine } from "./mongodb/engine.ts";
import { createMysqlEngine } from "./mysql/engine.ts";
import { createPostgresEngine } from "./postgres/engine.ts";
import type { Netguard } from "./postgres/pool.ts";
import type { CheckoutPlan, ConnectionRef, DbEngine, EncodedRow, Introspection } from "./types.ts";

/**
 * A snapshot or checkout hands back two things built from one pending connection: the stream, and
 * the manifest (or result) promise. The job drains the stream and reads the promise afterwards, so
 * when the connection is refused the promise rejects with nobody waiting on it yet. Bun ends the
 * process on an unhandled rejection, which turns "one database was briefly unreachable" into the
 * whole server going down, every other job with it.
 */
const DENIED: Netguard = {
  check: async () => ({ allowed: false, reason: "policy", matched: "127.0.0.1:1" }),
};

const EMPTY: Introspection = {
  tier: "tabular",
  fingerprint: "",
  tables: [],
  views: [],
  warnings: [],
};

async function* noRows(): AsyncGenerator<EncodedRow> {
  // The connection is refused long before the plan asks for a row.
}

const PLAN: CheckoutPlan = {
  tables: [],
  introspectionAtSnapshot: EMPTY,
  rows: () => noRows(),
  onDrift: "fail",
  lockTimeoutMs: 1_000,
  restoreMode: "atomic",
};

const CREDENTIALS = {
  host: "127.0.0.1",
  port: 1,
  database: "d",
  user: "u",
  password: "p",
} as const;

const ENGINES: { name: string; create: (guard: Netguard) => DbEngine; ref: ConnectionRef }[] = [
  {
    name: "postgres",
    create: createPostgresEngine,
    ref: { connectionId: "c1", config: { engine: "postgres", ssl: "disable", ...CREDENTIALS } },
  },
  {
    name: "mysql",
    create: createMysqlEngine,
    ref: { connectionId: "c2", config: { engine: "mysql", ssl: "disable", ...CREDENTIALS } },
  },
  {
    name: "mongodb",
    create: createMongodbEngine,
    ref: {
      connectionId: "c3",
      config: { engine: "mongodb", ssl: "disable", authSource: "admin", ...CREDENTIALS },
    },
  },
];

/** How many rejections reached the process. In Bun each one of these is an exit. */
async function escaped(work: () => Promise<void>): Promise<number> {
  let loose = 0;
  const collect = (): void => {
    loose += 1;
  };
  process.on("unhandledRejection", collect);
  await work();
  await Bun.sleep(50);
  process.off("unhandledRejection", collect);
  return loose;
}

async function drain(run: AsyncIterable<unknown>): Promise<void> {
  for await (const item of run) void item;
}

for (const engine of ENGINES) {
  test(`${engine.name}: a refused snapshot leaves no rejection loose`, async () => {
    const loose = await escaped(async () => {
      const run = engine.create(DENIED).snapshot(engine.ref, { excludeTables: [] });
      await expect(drain(run)).rejects.toThrow(/blocked/);
    });
    expect(loose).toBe(0);
  });

  test(`${engine.name}: a refused checkout leaves no rejection loose`, async () => {
    const loose = await escaped(async () => {
      const run = engine.create(DENIED).checkout(engine.ref, PLAN);
      await expect(drain(run)).rejects.toThrow(/blocked/);
    });
    expect(loose).toBe(0);
  });
}
