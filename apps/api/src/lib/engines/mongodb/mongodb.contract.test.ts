import { describe, expect, test } from "bun:test";
import { BSON, MongoClient } from "mongodb";
import type { Document } from "mongodb";
import type { ManifestTable } from "@testate/shared";

import type { Netguard } from "../postgres/pool.ts";
import type {
  ConnectionRef,
  EncodedRow,
  MongodbConfig,
  RowChunk,
  SnapshotManifest,
  TableRef,
} from "../types.ts";
import { parseVersion } from "./probe.ts";
import { createMongodbEngine, decodeRow } from "./engine.ts";

/** Contract test against `deploy/compose.engines.yml` (mongo on 27017, standalone); skipped when absent. */
const CONFIG: MongodbConfig = {
  engine: "mongodb",
  host: "127.0.0.1",
  port: 27017,
  database: "shop",
  user: "testate",
  password: "testate",
  ssl: "disable",
  authSource: "admin",
};
const URL = `mongodb://${CONFIG.user}:${CONFIG.password}@${CONFIG.host}:${CONFIG.port}/${CONFIG.database}?authSource=admin&directConnection=true`;

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

const netguard: Netguard = { check: async () => ({ allowed: true, addresses: ["127.0.0.1"] }) };

const FIRST_ID = new BSON.ObjectId("65f000000000000000000001");
const CUSTOMERS: Document[] = [
  {
    _id: FIRST_ID,
    email: "a@x.io",
    balance: new BSON.Decimal128("12345678901234567.8901"),
    big: BSON.Long.fromString("9007199254740993"),
    joined: new Date(0),
  },
  {
    _id: new BSON.ObjectId("65f000000000000000000002"),
    email: "b@x.io",
    balance: new BSON.Decimal128("1.5"),
    big: BSON.Long.fromNumber(1),
    joined: new Date(86400000),
  },
];
const ORDERS: Document[] = [
  { _id: 1, customer: FIRST_ID, total: 10, tags: ["x"] },
  { _id: 2, customer: FIRST_ID, total: 20.5, tags: [] },
  { _id: 3, customer: new BSON.ObjectId("65f000000000000000000002"), total: 5.25, note: null },
];

async function collect(run: AsyncIterable<RowChunk>): Promise<Map<string, EncodedRow[]>> {
  const rows = new Map<string, EncodedRow[]>();
  for await (const chunk of run)
    rows.set(chunk.table.name, [...(rows.get(chunk.table.name) ?? []), ...chunk.rows]);
  return rows;
}

function planTables(manifest: SnapshotManifest): ManifestTable[] {
  return manifest.tables.map((table) => ({
    schema: table.ref.schema,
    name: table.ref.name,
    rows: table.rows,
    bytes: table.bytes,
    blob_hash: "",
    sort: table.sort,
    warnings: table.warnings,
  }));
}

function rowsFrom(
  saved: Map<string, EncodedRow[]>
): (table: TableRef) => AsyncIterable<EncodedRow> {
  return async function* (table) {
    yield* saved.get(table.name) ?? [];
  };
}

function cursorOf(page: { nextCursor: string | null }): string {
  if (page.nextCursor === null) throw new Error("no next cursor");
  return page.nextCursor;
}

function firstRow(rows: EncodedRow[] | undefined): EncodedRow {
  const first = rows?.[0];
  if (first === undefined) throw new Error("no rows");
  return first;
}

describe("mongodb engine (pure)", () => {
  test("parses the version and the time-series floor", () => {
    expect(parseVersion("7.0.12")).toEqual({ major: 7, minor: 0, short: "7.0" });
    expect(parseVersion("6.0.15-rc0").short).toBe("6.0");
  });
});

describe.skipIf(!(await reachable()))("mongodb engine (contract)", () => {
  const admin = new MongoClient(URL);
  const engine = createMongodbEngine(netguard);
  const conn: ConnectionRef = { connectionId: "contract-mongodb", config: CONFIG };
  const reset = async (): Promise<void> => {
    const db = admin.db("shop");
    await db.dropDatabase();
    await db.collection("customers").insertMany(CUSTOMERS);
    await db.collection("orders").insertMany(ORDERS);
    await db.createCollection("open_orders", {
      viewOn: "orders",
      pipeline: [{ $match: { total: { $gt: 6 } } }],
    });
  };

  test("probe reports the document tier, the floor, and per-operation restores", async () => {
    await reset();
    const probe = await engine.probe(CONFIG);
    expect(probe).toMatchObject({
      engine: "mongodb",
      dialect: "mongodb",
      tier: "document",
      meets_floor: true,
      table_count: 2,
      strategy: { emptyMode: "delete-many", transactional: false },
    });
    expect(probe.capabilities.canTerminateSessions).toBe(true);
  });

  test("snapshot streams every collection in _id order as canonical Extended JSON", async () => {
    await reset();
    const run = engine.snapshot(conn, { excludeTables: [], chunkRows: 2 });
    const rows = await collect(run);
    const manifest = await run.manifest;
    expect(manifest.tables.map((table) => `${table.ref.name}:${table.rows}:${table.sort}`)).toEqual(
      ["customers:2:primary-key", "orders:3:primary-key"]
    );
    expect(manifest.introspection.views).toEqual([{ schema: null, name: "open_orders" }]);
    expect(rows.get("orders")?.map((row) => row.key.value)).toEqual([
      ['{"$numberInt":"1"}'],
      ['{"$numberInt":"2"}'],
      ['{"$numberInt":"3"}'],
    ]);
    const first = decodeRow(firstRow(rows.get("customers")).json);
    expect(first["big"]).toEqual({ $numberLong: "9007199254740993" });
    expect(first["balance"]).toEqual({ $numberDecimal: "12345678901234567.8901" });
    expect(first["_id"]).toEqual({ $oid: "65f000000000000000000001" });
  });

  test("checkout restores a mutated database with the original _id values and skips views", async () => {
    await reset();
    const run = engine.snapshot(conn, { excludeTables: [] });
    const saved = await collect(run);
    const manifest = await run.manifest;
    const db = admin.db("shop");
    await db.collection("orders").deleteMany({});
    await db.collection("customers").insertOne({ email: "c@x.io" });
    const checkout = engine.checkout(conn, {
      tables: planTables(manifest),
      introspectionAtSnapshot: manifest.introspection,
      rows: rowsFrom(saved),
      onDrift: "fail",
      lockTimeoutMs: 5000,
      restoreMode: "atomic",
    });
    for await (const item of checkout) expect(item.tablesTotal).toBe(2);
    const result = await checkout.result;
    expect(result.status).toBe("restored");
    expect(await db.collection("customers").countDocuments()).toBe(2);
    expect(await db.collection("orders").countDocuments()).toBe(3);
    const restored = await db.collection("customers").findOne({ _id: FIRST_ID });
    expect(restored?.["big"]).toEqual(BSON.Long.fromString("9007199254740993"));
    expect(restored?.["joined"]).toEqual(new Date(0));
  });

  test("checkout refuses on drift and leaves the database untouched", async () => {
    await reset();
    const run = engine.snapshot(conn, { excludeTables: [] });
    const saved = await collect(run);
    const manifest = await run.manifest;
    await admin.db("shop").createCollection("audit");
    await admin.db("shop").collection("orders").deleteMany({});
    const checkout = engine.checkout(conn, {
      tables: planTables(manifest),
      introspectionAtSnapshot: manifest.introspection,
      rows: rowsFrom(saved),
      onDrift: "fail",
      lockTimeoutMs: 5000,
      restoreMode: "atomic",
    });
    await expect(checkout.result).rejects.toThrow("the live schema differs from the state");
    expect(await admin.db("shop").collection("orders").countDocuments()).toBe(0);
  });

  test("pageRows, find and aggregate queries, and refusals of writes", async () => {
    await reset();
    const page = await engine.pageRows(conn, {
      table: { schema: null, name: "orders" },
      limit: 2,
      order: "desc",
      filters: [{ column: "total", op: "gt", value: "1" }],
    });
    expect(page.kind).toBe("keyset");
    expect(page.rows.map((row) => decodeRow(row)["_id"])).toEqual([
      { $numberInt: "3" },
      { $numberInt: "2" },
    ]);
    expect(page.nextCursor).not.toBeNull();
    const next = await engine.pageRows(conn, {
      table: { schema: null, name: "orders" },
      limit: 2,
      order: "desc",
      filters: [],
      cursor: cursorOf(page),
    });
    expect(next.rows.map((row) => decodeRow(row)["_id"])).toEqual([{ $numberInt: "1" }]);
    // Typed by what the text reads as: the grid shows these three as plain text.
    const typed = async (column: string, value: string): Promise<number> =>
      (
        await engine.pageRows(conn, {
          table: { schema: null, name: "customers" },
          limit: 10,
          order: "asc",
          filters: [{ column, op: "eq", value }],
        })
      ).rows.length;
    expect(await typed("_id", "65f000000000000000000001")).toBe(1);
    expect(await typed("big", "9007199254740993")).toBe(1);
    expect(await typed("joined", "1970-01-01T00:00:00.000Z")).toBe(1);
    expect(await typed("email", "a@x.io")).toBe(1);
    const opts = {
      mode: "read" as const,
      rowCap: 2,
      byteBudget: 1 << 20,
      timeBudgetMs: 5000,
      queryId: "q1",
    };
    const found = await engine.runQuery(
      conn,
      { text: JSON.stringify({ op: "find", collection: "orders", filter: {}, sort: { _id: 1 } }) },
      opts
    );
    expect(found.rows.length).toBe(2);
    expect(found.truncated).toBe(true);
    expect(found.columns).toContain("total");
    const grouped = await engine.runQuery(
      conn,
      {
        text: JSON.stringify({
          op: "aggregate",
          collection: "orders",
          pipeline: [{ $group: { _id: null, total: { $sum: "$total" } } }],
        }),
      },
      opts
    );
    expect(
      decodeRow(
        firstRow(grouped.rows.map((json) => ({ key: { by: "row-hash", value: "" }, json }))).json
      )["total"]
    ).toEqual({ $numberDouble: "35.75" });
    await expect(
      engine.runQuery(
        conn,
        {
          text: JSON.stringify({
            op: "aggregate",
            collection: "orders",
            pipeline: [{ $out: "x" }],
          }),
        },
        opts
      )
    ).rejects.toThrow("$out writes");
    await expect(engine.runQuery(conn, { text: "SELECT 1" }, opts)).rejects.toThrow("not SQL text");
    await expect(
      engine.writeRows(conn, { schema: null, name: "orders" }, [], { foreignKeyChecks: true })
    ).rejects.toMatchObject({ kind: "unsupported" });
    await engine.evict(conn.connectionId);
    await admin.close();
  });
});
