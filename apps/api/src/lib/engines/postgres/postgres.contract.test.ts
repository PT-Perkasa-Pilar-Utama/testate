import { describe, expect, test } from "bun:test";
import { SQL } from "bun";

import { createPostgresEngine, decodeRow } from "./engine.ts";
import {
  CONFIG,
  FIXTURE,
  URL,
  collect,
  conn,
  cursorOf,
  firstOf,
  firstRow,
  netguard,
  planTables,
  reachable,
  rowOf,
  rowsFrom,
} from "./postgres.contract.support.ts";

/** Contract test against `deploy/compose.engines.yml`; skipped when the server is not reachable. */
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

  test("pageRows pages by keyset with filters and sort, and by offset without a key", async () => {
    await admin.unsafe(FIXTURE);
    const first = await engine.pageRows(conn, {
      table: { schema: "contract", name: "orders" },
      limit: 2,
      order: "desc",
      filters: [{ column: "customer_id", op: "eq", value: "1" }],
    });
    expect(first.kind).toBe("keyset");
    expect(first.rows.map((row) => decodeRow(row)["id"])).toEqual([2, 1]);
    expect(first.nextCursor).toBeNull();
    const byTotal = await engine.pageRows(conn, {
      table: { schema: "contract", name: "orders" },
      limit: 1,
      sort: "total",
      order: "asc",
      filters: [],
    });
    expect(decodeRow(firstOf(byTotal.rows))["total"]).toBe(5.25);
    const next = await engine.pageRows(conn, {
      table: { schema: "contract", name: "orders" },
      limit: 1,
      sort: "total",
      order: "asc",
      filters: [],
      cursor: cursorOf(byTotal),
    });
    expect(decodeRow(firstOf(next.rows))["total"]).toBe(10);
    const notes = await engine.pageRows(conn, {
      table: { schema: "contract", name: "notes" },
      limit: 2,
      order: "asc",
      filters: [{ column: "body", op: "like", value: "t%" }],
    });
    expect(notes).toMatchObject({ kind: "offset", nextCursor: null });
    expect(notes.rows.length).toBe(2);
    await expect(
      engine.pageRows(conn, {
        table: { schema: "contract", name: "notes" },
        limit: 1,
        order: "asc",
        sort: "nope",
        filters: [],
      })
    ).rejects.toThrow("unknown column nope");
  });

  test("writeRows inserts, updates, and deletes in one transaction and rolls back on a failure", async () => {
    await admin.unsafe(FIXTURE);
    const customers = { schema: "contract", name: "customers" };
    const results = await engine.writeRows(
      conn,
      customers,
      [
        {
          kind: "insert",
          values: { email: { kind: "value", value: "c@x.io" }, balance: { kind: "default" } },
        },
        {
          kind: "update",
          pk: { id: 1 },
          values: { big: { kind: "value", value: "9007199254740995" } },
        },
        { kind: "delete", pk: { id: 3 } },
      ],
      { foreignKeyChecks: true }
    );
    expect(results.map((item) => item.kind)).toEqual(["insert", "update", "delete"]);
    expect(results[0]?.pk).toEqual({ id: 3 });
    expect(decodeRow(rowOf(results, 1))["big"]).toBe("9007199254740995");
    const orders = { schema: "contract", name: "orders" };
    await expect(
      engine.writeRows(
        conn,
        orders,
        [
          { kind: "delete", pk: { id: 1 } },
          { kind: "delete", pk: { id: 99 } },
        ],
        { foreignKeyChecks: true }
      )
    ).rejects.toMatchObject({ details: { failed_index: 1 } });
    const after = await admin.unsafe(
      "SELECT (SELECT COUNT(*) FROM contract.customers)::int AS c, (SELECT COUNT(*) FROM contract.orders)::int AS o"
    );
    expect(after[0]).toEqual({ c: 2, o: 3 });
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
