import { describe, expect, test } from "bun:test";
import { SQL } from "bun";

import { createPostgresEngine, decodeRow } from "./engine.ts";
import type { Netguard } from "./pool.ts";
import type { ManifestTable } from "@testate/shared";

import { rowText } from "../types.ts";
import type {
  ConnectionRef,
  EncodedRow,
  PostgresConfig,
  RowChunk,
  RowText,
  SnapshotManifest,
  TableRef,
} from "../types.ts";

/**
 * Contract test against `deploy/compose.engines.yml`. Skipped when the server is not reachable,
 * so `bun test` stays green on a laptop without Docker.
 */
const CONFIG: PostgresConfig = {
  engine: "postgres",
  host: "127.0.0.1",
  port: 54320,
  database: "shop",
  user: "testate",
  password: "testate",
  ssl: "disable",
};
const URL = `postgres://${CONFIG.user}:${CONFIG.password}@${CONFIG.host}:${CONFIG.port}/${CONFIG.database}`;

async function reachable(): Promise<boolean> {
  const sql = new SQL({ url: URL, connectionTimeout: 2, max: 1 });
  try {
    await sql.unsafe("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await sql.close();
  }
}

const FIXTURE = `
  DROP SCHEMA IF EXISTS contract CASCADE;
  CREATE SCHEMA contract;
  CREATE TABLE contract.customers (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email text NOT NULL UNIQUE,
    balance numeric(24,4) NOT NULL DEFAULT 0,
    big bigint NOT NULL DEFAULT 0
  );
  CREATE TABLE contract.orders (
    id serial PRIMARY KEY,
    customer_id bigint NOT NULL REFERENCES contract.customers(id),
    total numeric(12,2) NOT NULL,
    placed_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE contract.notes (body text NOT NULL);
  INSERT INTO contract.customers (email, balance, big) VALUES
    ('a@x.io', 12345678901234567.8901, 9007199254740993),
    ('b@x.io', 1.5, 1);
  INSERT INTO contract.orders (customer_id, total) VALUES (1, 10.00), (1, 20.50), (2, 5.25);
  INSERT INTO contract.notes VALUES ('one'), ('two'), ('two');
`;

const netguard: Netguard = { check: async () => ({ allowed: true, addresses: ["127.0.0.1"] }) };
const conn: ConnectionRef = {
  connectionId: "contract",
  config: { ...CONFIG, schemas: ["contract"] },
};

async function collect(run: AsyncIterable<RowChunk>): Promise<Map<string, EncodedRow[]>> {
  const rows = new Map<string, EncodedRow[]>();
  for await (const chunk of run) {
    const key = `${chunk.table.schema}.${chunk.table.name}`;
    rows.set(key, [...(rows.get(key) ?? []), ...chunk.rows]);
  }
  return rows;
}

function firstRow(rows: Map<string, EncodedRow[]>, key: string): RowText {
  const first = rows.get(key)?.[0];
  return first === undefined ? rowText("{}") : first.json;
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
    yield* saved.get(`${table.schema}.${table.name}`) ?? [];
  };
}

describe.skipIf(!(await reachable()))("postgres engine (contract)", () => {
  const admin = new SQL({ url: URL, max: 1 });
  const engine = createPostgresEngine(netguard);

  test("probe reports version, capabilities and a truncate-capable role", async () => {
    await admin.unsafe(FIXTURE);
    const probe = await engine.probe(CONFIG);
    expect(probe.version).toMatch(/^\d+/);
    expect(probe.capabilities.snapshotRead).toBe("repeatable-read");
    expect(probe.capabilities.canTruncate).toBe(true);
  });

  test("snapshot streams every table in key order and returns a manifest", async () => {
    await admin.unsafe(FIXTURE);
    const run = engine.snapshot(conn, { excludeTables: [], chunkRows: 2 });
    const rows = await collect(run);
    const manifest = await run.manifest;
    expect(manifest.consistency).toBe("snapshot");
    expect(manifest.tables.map((table) => `${table.ref.name}:${table.rows}:${table.sort}`)).toEqual(
      ["customers:2:primary-key", "notes:3:row-hash", "orders:3:primary-key"]
    );
    expect(rows.get("contract.orders")?.map((row) => row.key.value)).toEqual([[1], [2], [3]]);
    expect(rows.get("contract.notes")?.map((row) => row.key.by)).toEqual([
      "row-hash",
      "row-hash",
      "row-hash",
    ]);
  });

  test("decodeRow keeps big integers and wide decimals as text", async () => {
    await admin.unsafe(FIXTURE);
    const run = engine.snapshot(conn, { excludeTables: [] });
    const rows = await collect(run);
    const first = decodeRow(firstRow(rows, "contract.customers"));
    expect(first.big).toBe("9007199254740993");
    expect(first.balance).toBe("12345678901234567.8901");
    expect(first.email).toBe("a@x.io");
  });

  test("checkout restores a mutated database to the snapshot and repairs counters", async () => {
    await admin.unsafe(FIXTURE);
    const run = engine.snapshot(conn, { excludeTables: [] });
    const saved = await collect(run);
    const manifest = await run.manifest;
    await admin.unsafe(
      "DELETE FROM contract.orders; INSERT INTO contract.customers (email) VALUES ('c@x.io'); UPDATE contract.notes SET body = 'x'"
    );
    const checkout = engine.checkout(conn, {
      tables: planTables(manifest),
      introspectionAtSnapshot: manifest.introspection,
      rows: rowsFrom(saved),
      onDrift: "fail",
      lockTimeoutMs: 5000,
      restoreMode: "atomic",
    });
    const progress = [];
    for await (const item of checkout) progress.push(item);
    const result = await checkout.result;
    expect(result.status).toBe("restored");
    expect(result.tables.map((table) => `${table.ref.name}:${table.rows}`).sort()).toEqual([
      "customers:2",
      "notes:3",
      "orders:3",
    ]);
    expect(progress.length).toBeGreaterThan(0);
    expect(result.counters.every((counter) => counter.ok)).toBe(true);
    const after = await admin.unsafe(
      "SELECT (SELECT COUNT(*) FROM contract.customers)::int AS c, (SELECT COUNT(*) FROM contract.orders)::int AS o, (SELECT body FROM contract.notes LIMIT 1) AS n"
    );
    expect(after[0]).toEqual({ c: 2, o: 3, n: "one" });
    const next = await admin.unsafe(
      "INSERT INTO contract.orders (customer_id, total) VALUES (2, 1) RETURNING id"
    );
    expect(next[0].id).toBe(4);
  });

  test("checkout refuses on schema drift and leaves the database untouched", async () => {
    await admin.unsafe(FIXTURE);
    const run = engine.snapshot(conn, { excludeTables: [] });
    const saved = await collect(run);
    const manifest = await run.manifest;
    await admin.unsafe(
      "ALTER TABLE contract.orders ADD COLUMN note text; DELETE FROM contract.orders"
    );
    const checkout = engine.checkout(conn, {
      tables: planTables(manifest),
      introspectionAtSnapshot: manifest.introspection,
      rows: rowsFrom(saved),
      onDrift: "fail",
      lockTimeoutMs: 5000,
      restoreMode: "atomic",
    });
    await expect(checkout.result).rejects.toThrow("the live schema differs from the state");
    const after = await admin.unsafe("SELECT COUNT(*)::int AS o FROM contract.orders");
    expect(after[0].o).toBe(0);
  });

  test("runQuery caps rows, reports truncation, and read mode never writes", async () => {
    await admin.unsafe(FIXTURE);
    const opts = {
      mode: "read" as const,
      rowCap: 2,
      byteBudget: 1 << 20,
      timeBudgetMs: 5000,
      queryId: "q1",
    };
    const result = await engine.runQuery(
      conn,
      { text: "SELECT id, total FROM contract.orders ORDER BY id" },
      opts
    );
    expect(result.columns).toEqual(["id", "total"]);
    expect(result.rows.length).toBe(2);
    expect(result.truncated).toBe(true);
    await expect(
      engine.runQuery(conn, { text: "DELETE FROM contract.orders" }, opts)
    ).rejects.toThrow("read-only");
    expect(await engine.probe(CONFIG)).toBeDefined();
    await engine.evict(conn.connectionId);
    await admin.close();
  });
});
