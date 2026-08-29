import type { SQL } from "bun";
import type { Introspection, JsonObject, JsonValue, TableRef, TableSchema } from "@testate/shared";
import { jsonObjectSchema } from "@testate/shared";
import * as v from "valibot";

import { computeDependencyOrder } from "../pure/dependency-order.ts";
import { diffSchema, forceIntersection } from "../pure/diff-schema.ts";
import type { ForceIntersection } from "../pure/diff-schema.ts";
import { EngineError, sameTable, tableKey } from "../types.ts";
import type {
  CheckoutPlan,
  CheckoutProgress,
  CheckoutResult,
  CheckoutRun,
  CounterResult,
  EncodedRow,
} from "../types.ts";
import { translate } from "./errors.ts";
import { introspect } from "./introspect.ts";
import { quoteIdent } from "./pool.ts";
import { swallow } from "./reader.ts";

const BATCH_ROWS = 500;

type Reserved = Awaited<ReturnType<SQL["reserve"]>>;

const maxRow = v.object({ m: v.nullable(v.union([v.number(), v.string(), v.bigint()])) });

/** JSON cells back to bind values: objects and arrays as JSON text, HEX blobs decoded by the server. */
function bindValue(value: JsonValue | undefined): string | null {
  if (value === undefined || value === null) return null;
  return v.is(v.string(), value) ? value : JSON.stringify(value);
}

type Bound = { sql: string; params: (string | null)[] };

function insertStatement(
  table: TableSchema,
  columns: TableSchema["columns"],
  rows: JsonObject[]
): Bound {
  const params: (string | null)[] = [];
  const tuples = rows.map(
    (row) =>
      `(${columns
        .map((column) => {
          const bound = bindValue(row[column.name]);
          params.push(bound);
          return /^(binary|varbinary|blob|tinyblob|mediumblob|longblob|bit)/i.test(column.type)
            ? "UNHEX(?)"
            : "?";
        })
        .join(", ")})`
  );
  return {
    sql: `INSERT INTO ${quoteIdent(table.name)} (${columns.map((column) => quoteIdent(column.name)).join(", ")}) VALUES ${tuples.join(", ")}`,
    params,
  };
}

async function insertRows(
  conn: Reserved,
  table: TableSchema,
  skip: Set<string>,
  rows: AsyncIterable<EncodedRow>,
  signal: AbortSignal | undefined,
  onBatch: (rows: number) => void
): Promise<number> {
  const columns = table.columns.filter((column) => !column.generated && !skip.has(column.name));
  if (columns.length === 0) return 0;
  let batch: JsonObject[] = [];
  let total = 0;
  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;
    const statement = insertStatement(table, columns, batch);
    await conn.unsafe(statement.sql, statement.params);
    total += batch.length;
    onBatch(batch.length);
    batch = [];
  };
  for await (const row of rows) {
    if (signal?.aborted) throw new EngineError("cancelled", "checkout cancelled between batches");
    batch.push(v.parse(jsonObjectSchema, JSON.parse(row.json)));
    if (batch.length >= BATCH_ROWS) await flush();
  }
  await flush();
  return total;
}

/** `ALTER TABLE ... AUTO_INCREMENT = max + 1` per restored table with an auto column (13 §13.5). */
export async function resetCounters(
  sql: Pick<SQL, "unsafe">,
  tables: TableRef[],
  live: Introspection
): Promise<CounterResult[]> {
  const results: CounterResult[] = [];
  for (const ref of tables) {
    const table = live.tables.find((item) => sameTable(item, ref));
    const auto = table?.columns.find((column) => column.identity);
    if (table === undefined || auto === undefined) continue;
    const name = `${table.name}.${auto.name}`;
    try {
      const max = v.parse(
        maxRow,
        (
          await sql.unsafe(
            `SELECT MAX(${quoteIdent(auto.name)}) AS m FROM ${quoteIdent(table.name)}`
          )
        )[0]
      ).m;
      const next = max === null ? 1 : Number(max) + 1;
      await sql.unsafe(
        `ALTER TABLE ${quoteIdent(table.name)} AUTO_INCREMENT = ${Math.max(1, Math.floor(next))}`
      );
      results.push({ name, ok: true });
    } catch (cause: unknown) {
      results.push({ name, ok: false, error: translate(cause, "auto_increment").message });
    }
  }
  return results;
}

type Prepared = {
  targets: TableSchema[];
  skip: Map<string, Set<string>>;
  live: Introspection;
  result: CheckoutResult;
};

function skipMap(forced: ForceIntersection | null): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const column of forced?.skippedColumns ?? []) {
    const set = map.get(tableKey(column.table)) ?? new Set<string>();
    set.add(column.column);
    map.set(tableKey(column.table), set);
  }
  return map;
}

async function prepare(conn: Reserved, plan: CheckoutPlan): Promise<Prepared> {
  const live = await introspect(conn, []);
  const drift = diffSchema(plan.introspectionAtSnapshot, live);
  if (drift.changed && plan.onDrift === "fail")
    throw new EngineError("schema_drift", "the live schema differs from the state", { drift });
  const wanted = plan.tables.map((table): TableRef => ({ schema: null, name: table.name }));
  const forced = drift.changed ? forceIntersection(plan.introspectionAtSnapshot, live) : null;
  const restorable =
    forced === null
      ? wanted
      : wanted.filter((ref) => forced.tables.some((item) => sameTable(item, ref)));
  const order = computeDependencyOrder(live.tables, restorable).order;
  const inPlan = (ref: TableRef): boolean => restorable.some((item) => sameTable(item, ref));
  return {
    targets: order.flatMap((ref) => live.tables.filter((table) => sameTable(table, ref))),
    skip: skipMap(forced),
    live,
    result: {
      status: "unknown",
      strategy: {
        emptyMode: "delete",
        foreignKeyHandling: "session-disable",
        transactional: true,
        triggerDisable: false,
        locking: "row",
      },
      tables: [],
      skipped: {
        tables: wanted.filter((ref) => !inPlan(ref)),
        columns: (forced?.skippedColumns ?? []).filter((column) => inPlan(column.table)),
      },
      defaultedColumns: (forced?.defaultedColumns ?? []).filter((column) => inPlan(column.table)),
      counters: [],
      lockWaitMs: 0,
      batches: 0,
      warnings: [],
    },
  };
}

async function restoreAll(
  conn: Reserved,
  plan: CheckoutPlan,
  push: (item: CheckoutProgress) => void
): Promise<CheckoutResult> {
  await conn.unsafe(
    `SET SESSION innodb_lock_wait_timeout = ${Math.max(1, Math.ceil(plan.lockTimeoutMs / 1000))}`
  );
  await conn.unsafe("SET SESSION FOREIGN_KEY_CHECKS = 0");
  await conn.unsafe("SET SESSION time_zone = '+00:00'");
  await conn.unsafe("START TRANSACTION");
  const prepared = await prepare(conn, plan);
  const { targets, result } = prepared;
  const started = Date.now();
  for (const table of [...targets].reverse())
    await conn.unsafe(`DELETE FROM ${quoteIdent(table.name)}`);
  result.lockWaitMs = Date.now() - started;
  for (const [index, table] of targets.entries()) {
    const ref: TableRef = { schema: null, name: table.name };
    const rows = await insertRows(
      conn,
      table,
      prepared.skip.get(tableKey(ref)) ?? new Set(),
      plan.rows(ref),
      plan.signal,
      (count) => {
        result.batches += 1;
        push({ table: ref, rows: count, tablesDone: index, tablesTotal: targets.length });
      }
    );
    result.tables.push({ ref, rows });
  }
  await conn.unsafe("COMMIT");
  result.status = "restored";
  result.counters = await resetCounters(
    conn,
    targets.map((table) => ({ schema: null, name: table.name })),
    prepared.live
  );
  return result;
}

/** MySQL restore (13 §13.5, atomic mode): FK checks off for the session, one transaction, counters after commit. */
export function checkout(sql: SQL, plan: CheckoutPlan): CheckoutRun {
  const progress: CheckoutProgress[] = [];
  let wake: (() => void) | null = null;
  let finished = false;
  const push = (item: CheckoutProgress): void => {
    progress.push(item);
    wake?.();
  };
  const run = async (): Promise<CheckoutResult> => {
    const conn = await sql.reserve();
    try {
      return await restoreAll(conn, plan, push);
    } catch (cause: unknown) {
      await swallow(conn.unsafe("ROLLBACK"));
      throw translate(cause, "checkout");
    } finally {
      await swallow(conn.unsafe("SET SESSION FOREIGN_KEY_CHECKS = 1"));
      conn.release();
      finished = true;
      wake?.();
    }
  };
  const result = run();
  void swallow(result);
  return {
    result,
    async *[Symbol.asyncIterator]() {
      while (!finished || progress.length > 0) {
        const item = progress.shift();
        if (item !== undefined) {
          yield item;
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = null;
      }
    },
  };
}
