import type { SQL } from "bun";
import type { Introspection, TableRef, TableSchema } from "@testate/shared";
import * as v from "valibot";

import { computeDependencyOrder } from "../pure/dependency-order.ts";
import { diffSchema, forceIntersection } from "../pure/diff-schema.ts";
import type { ForceIntersection } from "../pure/diff-schema.ts";
import { isRefusal, selectRestoreStrategy } from "../pure/strategy.ts";
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
import { blockingSessions } from "./query.ts";
import { introspect } from "./introspect.ts";
import { pgArray, quoteIdent, quoteTable } from "./pool.ts";
import { swallow } from "./reader.ts";
import { probe } from "./probe.ts";

const BATCH_ROWS = 1000;

type Reserved = Awaited<ReturnType<SQL["reserve"]>>;

const countRow = v.object({ n: v.number() });
const sequenceRow = v.object({
  seq: v.string(),
  column: v.string(),
  schema: v.string(),
  table_name: v.string(),
});

/** Column list and record definition for `jsonb_to_recordset`; generated columns are never inserted. */
function insertFor(table: TableSchema, skip: Set<string>): string | null {
  const columns = table.columns.filter((column) => !column.generated && !skip.has(column.name));
  if (columns.length === 0) return null;
  const names = columns.map((column) => quoteIdent(column.name)).join(", ");
  const record = columns.map((column) => `${quoteIdent(column.name)} ${column.type}`).join(", ");
  const overriding = table.columns.some((column) => column.identity)
    ? " OVERRIDING SYSTEM VALUE"
    : "";
  return `INSERT INTO ${quoteTable(table.schema, table.name)} (${names})${overriding} SELECT ${names} FROM jsonb_to_recordset($1::text::jsonb) AS r(${record})`;
}

async function insertBatches(
  conn: Reserved,
  table: TableSchema,
  rows: AsyncIterable<EncodedRow>,
  skip: Set<string>,
  signal: AbortSignal | undefined,
  onBatch: (rows: number) => void
): Promise<number> {
  const insert = insertFor(table, skip);
  if (insert === null) return 0;
  let batch: string[] = [];
  let total = 0;
  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;
    await conn.unsafe(insert, [`[${batch.join(",")}]`]);
    total += batch.length;
    onBatch(batch.length);
    batch = [];
  };
  for await (const row of rows) {
    if (signal?.aborted) throw new EngineError("cancelled", "checkout cancelled between batches");
    batch.push(row.json);
    if (batch.length >= BATCH_ROWS) await flush();
  }
  await flush();
  return total;
}

/** `setval` for every sequence owned by a column of a restored table, after the commit (13 §13.4 step 7). */
export async function resetCounters(
  sql: Pick<SQL, "unsafe">,
  tables: TableRef[]
): Promise<CounterResult[]> {
  if (tables.length === 0) return [];
  const names = tables.map((table) => `${table.schema ?? "public"}.${table.name}`);
  const rows = v.parse(v.array(sequenceRow), [
    ...(await sql.unsafe(
      `SELECT s.relname AS seq, a.attname AS column, n.nspname AS schema, c.relname AS table_name
         FROM pg_depend d
         JOIN pg_class s ON s.oid = d.objid AND s.relkind = 'S'
         JOIN pg_class c ON c.oid = d.refobjid JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.refobjsubid
         WHERE d.deptype IN ('a', 'i') AND (n.nspname || '.' || c.relname) = ANY($1::text[])`,
      [pgArray(names)]
    )),
  ]);
  const results: CounterResult[] = [];
  for (const row of rows) {
    const name = `${row.schema}.${row.seq}`;
    try {
      await sql.unsafe(
        `SELECT setval($1, COALESCE((SELECT MAX(${quoteIdent(row.column)}) FROM ${quoteTable(row.schema, row.table_name)}), 0) + 1, false)`,
        [name]
      );
      results.push({ name, ok: true });
    } catch (cause: unknown) {
      results.push({ name, ok: false, error: translate(cause, "setval").message });
    }
  }
  return results;
}

async function tablesHoldingRows(conn: Reserved, tables: TableRef[]): Promise<TableRef[]> {
  const holding: TableRef[] = [];
  for (const table of tables) {
    const rows = await conn.unsafe(
      `SELECT (EXISTS (SELECT 1 FROM ONLY ${quoteTable(table.schema, table.name)}))::int AS n`
    );
    if (v.parse(countRow, rows[0]).n === 1) holding.push(table);
  }
  return holding;
}

type Selection = { restorable: TableRef[]; forced: ForceIntersection | null };

/** Drift check and, under force, the intersection (13 §13.2 step 4). */
function selectTables(plan: CheckoutPlan, live: Introspection): Selection {
  const drift = diffSchema(plan.introspectionAtSnapshot, live);
  if (drift.changed && plan.onDrift === "fail") {
    throw new EngineError("schema_drift", "the live schema differs from the state", { drift });
  }
  const wanted = plan.tables.map((table): TableRef => ({ schema: table.schema, name: table.name }));
  if (!drift.changed) return { restorable: wanted, forced: null };
  const forced = forceIntersection(plan.introspectionAtSnapshot, live);
  return {
    restorable: wanted.filter((ref) => forced.tables.some((item) => sameTable(item, ref))),
    forced,
  };
}

/**
 * Columns the insert leaves out: the ones force skips, and the ones only the live table has.
 * A live-only column must take its own default — naming it would write NULL into it (13 §13.2).
 */
function skipMap(forced: ForceIntersection | null): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const column of [...(forced?.skippedColumns ?? []), ...(forced?.defaultedColumns ?? [])]) {
    const set = map.get(tableKey(column.table)) ?? new Set<string>();
    set.add(column.column);
    map.set(tableKey(column.table), set);
  }
  return map;
}

type Prepared = {
  targets: TableSchema[];
  skipColumns: Map<string, Set<string>>;
  truncateSet: TableRef[];
  result: CheckoutResult;
};

/** Everything decided before anything is written: drift, force, dependency plan, strategy. */
async function prepare(sql: SQL, conn: Reserved, plan: CheckoutPlan): Promise<Prepared> {
  const probed = await probe(sql);
  const live = await introspect(conn, []);
  const { restorable, forced } = selectTables(plan, live);
  const dependency = computeDependencyOrder(live.tables, restorable);
  const outside = dependency.outsideReferencers.filter(
    (ref) => live.tables.find((table) => sameTable(table, ref))?.excluded !== true
  );
  const holding = await tablesHoldingRows(conn, outside);
  if (holding.length > 0) {
    throw new EngineError(
      "checkout_blocked",
      "tables outside the state reference restored tables and hold rows",
      { tables: holding.map(tableKey) }
    );
  }
  const strategy = selectRestoreStrategy(
    probed.capabilities,
    probed.capabilities.supportsDeferrableConstraints
  );
  if (isRefusal(strategy)) throw new EngineError("privilege_missing", strategy.reason);
  const inPlan = (ref: TableRef): boolean => restorable.some((item) => sameTable(item, ref));
  const wanted = plan.tables.map((table): TableRef => ({ schema: table.schema, name: table.name }));
  return {
    targets: dependency.order.flatMap((ref) =>
      live.tables.filter((table) => sameTable(table, ref))
    ),
    skipColumns: skipMap(forced),
    truncateSet: dependency.truncateSet,
    result: {
      status: "unknown",
      strategy,
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

/** Truncate the FK closure in one statement, or delete in reverse dependency order (12 §12.3). */
async function emptyTables(conn: Reserved, prepared: Prepared): Promise<number> {
  if (prepared.truncateSet.length === 0) return 0;
  const started = Date.now();
  if (prepared.result.strategy.emptyMode === "truncate") {
    await conn.unsafe(
      `TRUNCATE ${prepared.truncateSet.map((ref) => quoteTable(ref.schema, ref.name)).join(", ")}`
    );
  } else {
    for (const ref of [...prepared.truncateSet].reverse())
      await conn.unsafe(`DELETE FROM ONLY ${quoteTable(ref.schema, ref.name)}`);
  }
  return Date.now() - started;
}

async function restoreAll(
  sql: SQL,
  conn: Reserved,
  plan: CheckoutPlan,
  push: (item: CheckoutProgress) => void
): Promise<CheckoutResult> {
  await conn.unsafe(`SET lock_timeout = ${Math.max(1, Math.floor(plan.lockTimeoutMs))}`);
  await conn.unsafe("BEGIN");
  await conn.unsafe("SET LOCAL TIME ZONE 'UTC'");
  const prepared = await prepare(sql, conn, plan);
  const { targets, result } = prepared;
  if (result.strategy.triggerDisable)
    await conn.unsafe("SET LOCAL session_replication_role = replica");
  result.lockWaitMs = await emptyTables(conn, prepared);
  for (const [index, table] of targets.entries()) {
    const ref: TableRef = { schema: table.schema, name: table.name };
    const skip = prepared.skipColumns.get(tableKey(ref)) ?? new Set<string>();
    const rows = await insertBatches(conn, table, plan.rows(ref), skip, plan.signal, (count) => {
      result.batches += 1;
      push({ table: ref, rows: count, tablesDone: index, tablesTotal: targets.length });
    });
    result.tables.push({ ref, rows });
  }
  await conn.unsafe("COMMIT");
  result.status = "restored";
  result.counters = await resetCounters(
    conn,
    targets.map((table) => ({ schema: table.schema, name: table.name }))
  );
  return result;
}

/**
 * Postgres restore (13 §13.4): reserve, lock timeout, one transaction, truncate the FK closure,
 * insert in dependency order, commit, then counters as a tracked step. Push-driven.
 */
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
      return await restoreAll(sql, conn, plan, push);
    } catch (cause: unknown) {
      await swallow(conn.unsafe("ROLLBACK"));
      const error = translate(cause, "checkout");
      if (error.kind === "lock_timeout")
        error.details["blocking_sessions"] = await blockingSessions(sql);
      throw error;
    } finally {
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
