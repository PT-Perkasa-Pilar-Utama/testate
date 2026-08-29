import { describe, expect, test } from "bun:test";
import { SQL } from "bun";
import type { ManifestTable } from "@testate/shared";

import type {
  ConnectionRef,
  EncodedRow,
  MysqlConfig,
  RowChunk,
  RowOpResult,
  RowText,
  SnapshotManifest,
  TableRef,
} from "../types.ts";
import type { Netguard } from "../postgres/pool.ts";
import { createMysqlEngine, decodeRow } from "./engine.ts";
import { dialectOf, grantsAllow } from "./probe.ts";

/** Contract test against `deploy/compose.engines.yml` (mysql on 33060, mariadb on 33070); skipped when absent. */
function configFor(engine: "mysql" | "mariadb", port: number): MysqlConfig {
  return {
    engine,
    host: "127.0.0.1",
    port,
    database: "shop",
    user: "testate",
    password: "testate",
    ssl: "disable",
  };
}

const TARGETS = [configFor("mysql", 33060), configFor("mariadb", 33070)];

async function reachable(config: MysqlConfig): Promise<boolean> {
  const options = {
    adapter: "mysql",
    hostname: config.host,
    port: config.port,
    database: config.database,
    username: config.user,
    password: config.password,
    max: 1,
    connectionTimeout: 2,
    allowPublicKeyRetrieval: true,
  };
  // SAFETY: `allowPublicKeyRetrieval` is a documented Bun MySQL option missing from the bundled types.
  const sql = new SQL(options as ConstructorParameters<typeof SQL>[0]);
  try {
    await sql.unsafe("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await sql.close();
  }
}

const FIXTURE = [
  "DROP TABLE IF EXISTS t",
  "DROP TABLE IF EXISTS orders",
  "DROP TABLE IF EXISTS notes",
  "DROP TABLE IF EXISTS customers",
  "CREATE TABLE customers (id BIGINT AUTO_INCREMENT PRIMARY KEY, email VARCHAR(120) NOT NULL UNIQUE, balance DECIMAL(24,4) NOT NULL DEFAULT 0, big BIGINT NOT NULL DEFAULT 0)",
  "CREATE TABLE orders (id INT AUTO_INCREMENT PRIMARY KEY, customer_id BIGINT NOT NULL, total DECIMAL(12,2) NOT NULL, placed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers(id))",
  "CREATE TABLE notes (body TEXT NOT NULL)",
  "INSERT INTO customers (email, balance, big) VALUES ('a@x.io', 12345678901234567.8901, 9007199254740993), ('b@x.io', 1.5, 1)",
  "INSERT INTO orders (customer_id, total) VALUES (1, 10.00), (1, 20.50), (2, 5.25)",
  "INSERT INTO notes VALUES ('one'), ('two'), ('two')",
];

const netguard: Netguard = { check: async () => ({ allowed: true, addresses: ["127.0.0.1"] }) };

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

function firstJson(rows: EncodedRow[] | undefined): RowText {
  const first = rows?.[0];
  if (first === undefined) throw new Error("no rows");
  return first.json;
}

function rowOf(results: RowOpResult[], index: number): RowText {
  const row = results[index]?.row;
  if (row === undefined || row === null) throw new Error(`result ${index} has no row`);
  return row;
}

function rowsFrom(
  saved: Map<string, EncodedRow[]>
): (table: TableRef) => AsyncIterable<EncodedRow> {
  return async function* (table) {
    yield* saved.get(table.name) ?? [];
  };
}

describe("mysql engine (pure)", () => {
  test("dialect and floor from the version string; grants by name or ALL", () => {
    expect(dialectOf("8.4.11")).toEqual({ name: "mysql", version: "8.4", meetsFloor: true });
    expect(dialectOf("11.4.13-MariaDB-ubu2404")).toEqual({
      name: "mariadb",
      version: "11.4",
      meetsFloor: true,
    });
    expect(dialectOf("5.7.44").meetsFloor).toBe(false);
    expect(dialectOf("10.5.1-MariaDB").meetsFloor).toBe(false);
    expect(grantsAllow(["GRANT ALL PRIVILEGES ON `shop`.* TO `t`@`%`"], "DROP")).toBe(true);
    expect(grantsAllow(["GRANT SELECT, INSERT ON `shop`.* TO `t`@`%`"], "DROP")).toBe(false);
  });
});

for (const config of TARGETS) {
  describe.skipIf(!(await reachable(config)))(`${config.engine} engine (contract)`, () => {
    const options = {
      adapter: "mysql",
      hostname: config.host,
      port: config.port,
      database: config.database,
      username: config.user,
      password: config.password,
      max: 1,
      allowPublicKeyRetrieval: true,
    };
    // SAFETY: `allowPublicKeyRetrieval` is a documented Bun MySQL option missing from the bundled types.
    const admin = new SQL(options as ConstructorParameters<typeof SQL>[0]);
    const engine = createMysqlEngine(netguard);
    const conn: ConnectionRef = { connectionId: `contract-${config.engine}`, config };
    const reset = async (): Promise<void> => {
      for (const statement of FIXTURE) await admin.unsafe(statement);
    };

    test("probe reports the dialect, floor, and DROP-backed truncate capability", async () => {
      await reset();
      const probe = await engine.probe(config);
      expect(probe.dialect).toBe(config.engine);
      expect(probe.meets_floor).toBe(true);
      expect(probe.capabilities.snapshotRead).toBe("consistent-snapshot");
      expect(probe.table_count).toBe(3);
    });

    test("snapshot streams every table in key order with big numbers as text", async () => {
      await reset();
      const run = engine.snapshot(conn, { excludeTables: [], chunkRows: 2 });
      const rows = await collect(run);
      const manifest = await run.manifest;
      expect(manifest.consistency).toBe("snapshot");
      expect(
        manifest.tables.map((table) => `${table.ref.name}:${table.rows}:${table.sort}`)
      ).toEqual(["customers:2:primary-key", "notes:3:row-hash", "orders:3:primary-key"]);
      expect(rows.get("orders")?.map((row) => row.key.value)).toEqual([[1], [2], [3]]);
      const first = decodeRow(firstJson(rows.get("customers")));
      expect(first["big"]).toBe("9007199254740993");
      expect(first["balance"]).toBe("12345678901234567.8901");
    });

    test("checkout restores a mutated database and resets auto_increment", async () => {
      await reset();
      const run = engine.snapshot(conn, { excludeTables: [] });
      const saved = await collect(run);
      const manifest = await run.manifest;
      await admin.unsafe("DELETE FROM orders");
      await admin.unsafe("INSERT INTO customers (email) VALUES ('c@x.io')");
      const checkout = engine.checkout(conn, {
        tables: planTables(manifest),
        introspectionAtSnapshot: manifest.introspection,
        rows: rowsFrom(saved),
        onDrift: "fail",
        lockTimeoutMs: 5000,
        restoreMode: "atomic",
      });
      for await (const item of checkout) expect(item.tablesTotal).toBe(3);
      const result = await checkout.result;
      expect(result.status).toBe("restored");
      expect(result.counters.every((counter) => counter.ok)).toBe(true);
      const after = await admin.unsafe(
        "SELECT (SELECT COUNT(*) FROM customers) AS c, (SELECT COUNT(*) FROM orders) AS o"
      );
      expect(Number(after[0].c)).toBe(2);
      expect(Number(after[0].o)).toBe(3);
      const next = await admin.unsafe("INSERT INTO orders (customer_id, total) VALUES (2, 1)");
      expect(Number(next.lastInsertRowid)).toBe(4);
    });

    test("checkout refuses on drift and leaves the database untouched", async () => {
      await reset();
      const run = engine.snapshot(conn, { excludeTables: [] });
      const saved = await collect(run);
      const manifest = await run.manifest;
      await admin.unsafe("ALTER TABLE orders ADD COLUMN note TEXT NULL");
      await admin.unsafe("DELETE FROM orders");
      const checkout = engine.checkout(conn, {
        tables: planTables(manifest),
        introspectionAtSnapshot: manifest.introspection,
        rows: rowsFrom(saved),
        onDrift: "fail",
        lockTimeoutMs: 5000,
        restoreMode: "atomic",
      });
      await expect(checkout.result).rejects.toThrow("the live schema differs from the state");
      const after = await admin.unsafe("SELECT COUNT(*) AS o FROM orders");
      expect(Number(after[0].o)).toBe(0);
    });

    test("pageRows, writeRows, importRows, and read-only queries behave like the Postgres engine", async () => {
      await reset();
      const page = await engine.pageRows(conn, {
        table: { schema: null, name: "orders" },
        limit: 2,
        order: "desc",
        filters: [{ column: "customer_id", op: "eq", value: "1" }],
      });
      expect(page.kind).toBe("keyset");
      expect(page.rows.map((row) => decodeRow(row)["id"])).toEqual([2, 1]);
      const written = await engine.writeRows(
        conn,
        { schema: null, name: "customers" },
        [
          { kind: "insert", values: { email: { kind: "value", value: "c@x.io" } } },
          {
            kind: "update",
            pk: { id: 1 },
            values: { big: { kind: "value", value: "9007199254740995" } },
          },
        ],
        { foreignKeyChecks: true }
      );
      expect(written[0]?.pk).toEqual({ id: 3 });
      expect(decodeRow(rowOf(written, 1))["big"]).toBe("9007199254740995");
      await expect(
        engine.writeRows(
          conn,
          { schema: null, name: "customers" },
          [{ kind: "delete", pk: { id: 99 } }],
          { foreignKeyChecks: true }
        )
      ).rejects.toMatchObject({ details: { failed_index: 0 } });
      const imported = await engine.importRows(
        conn,
        { schema: null, name: "customers" },
        [
          { email: { kind: "value", value: "a@x.io" }, big: { kind: "value", value: 7 } },
          { email: { kind: "value", value: "d@x.io" } },
        ],
        { mode: "upsert", keyColumns: ["email"], foreignKeyChecks: true, firstBatch: true }
      );
      expect(imported).toEqual({ inserted: 1, updated: 1, failures: [] });
      const opts = {
        mode: "read" as const,
        rowCap: 2,
        byteBudget: 1 << 20,
        timeBudgetMs: 5000,
        queryId: "q1",
      };
      const result = await engine.runQuery(
        conn,
        { text: "SELECT id, total FROM orders ORDER BY id" },
        opts
      );
      expect(result.columns).toEqual(["id", "total"]);
      expect(result.truncated).toBe(true);
      await expect(engine.runQuery(conn, { text: "DELETE FROM orders" }, opts)).rejects.toThrow();
      await engine.evict(conn.connectionId);
      await admin.close();
    });
  });
}
