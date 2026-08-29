import type { Collection, Document } from "mongodb";
import type { EngineWarning, TableRef, TableSchema } from "@testate/shared";

import { swallow } from "../mysql/reader.ts";
import { diffSchema, forceIntersection } from "../pure/diff-schema.ts";
import { EngineError, sameTable } from "../types.ts";
import type {
  CheckoutPlan,
  CheckoutProgress,
  CheckoutResult,
  CheckoutRun,
  EncodedRow,
} from "../types.ts";
import type { MongoHandle } from "./client.ts";
import { translate } from "./client.ts";
import { decodeDocument } from "./codec.ts";
import { introspect } from "./introspect.ts";
import type { Topology } from "./probe.ts";

const BATCH_DOCS = 1000;

function emptyResult(): CheckoutResult {
  return {
    status: "unknown",
    strategy: {
      emptyMode: "delete-many",
      foreignKeyHandling: "not-applicable",
      transactional: false,
      triggerDisable: false,
      locking: "per-operation",
    },
    tables: [],
    skipped: { tables: [], columns: [] },
    defaultedColumns: [],
    counters: [],
    lockWaitMs: 0,
    batches: 0,
    warnings: [],
  };
}

/** `insertMany` unordered, 1 000 documents per batch, original `_id` kept (13 §13.6). */
async function insertDocuments(
  collection: Collection,
  rows: AsyncIterable<EncodedRow>,
  signal: AbortSignal | undefined,
  onBatch: (count: number) => void
): Promise<number> {
  let batch: Document[] = [];
  let total = 0;
  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;
    if (signal?.aborted) throw new EngineError("cancelled", "checkout cancelled");
    await collection.insertMany(batch, { ordered: false });
    total += batch.length;
    onBatch(batch.length);
    batch = [];
  };
  for await (const row of rows) {
    batch.push(decodeDocument(row.json));
    if (batch.length >= BATCH_DOCS) await flush();
  }
  await flush();
  return total;
}

type Prepared = { targets: TableSchema[]; result: CheckoutResult };

async function prepare(
  handle: MongoHandle,
  topology: Topology,
  plan: CheckoutPlan
): Promise<Prepared> {
  const live = await introspect(handle.db, [], topology.timeSeriesDeletes);
  const drift = diffSchema(plan.introspectionAtSnapshot, live);
  if (drift.changed && plan.onDrift === "fail")
    throw new EngineError("schema_drift", "the live schema differs from the state", { drift });
  const wanted = plan.tables.map((table): TableRef => ({ schema: null, name: table.name }));
  const forced = drift.changed ? forceIntersection(plan.introspectionAtSnapshot, live) : null;
  const restorable =
    forced === null
      ? wanted
      : wanted.filter((ref) => forced.tables.some((item) => sameTable(item, ref)));
  const result = emptyResult();
  const targets: TableSchema[] = [];
  for (const ref of restorable) {
    const table = live.tables.find((item) => sameTable(item, ref));
    if (table === undefined) continue;
    if (table.unsupported.length > 0) {
      result.skipped.tables.push(ref);
      result.warnings.push({
        code: "time_series",
        table: table.name,
        message: table.unsupported.map((item) => item.reason).join(", "),
      });
      continue;
    }
    targets.push(table);
  }
  result.skipped.tables.push(
    ...wanted.filter((ref) => !restorable.some((item) => sameTable(item, ref)))
  );
  return { targets, result };
}

async function restoreAll(
  handle: MongoHandle,
  topology: Topology,
  plan: CheckoutPlan,
  push: (item: CheckoutProgress) => void
): Promise<CheckoutResult> {
  const { targets, result } = await prepare(handle, topology, plan);
  for (const [index, table] of targets.entries()) {
    const ref: TableRef = { schema: null, name: table.name };
    const collection = handle.db.collection(table.name);
    await collection.deleteMany({});
    const rows = await insertDocuments(collection, plan.rows(ref), plan.signal, (count) => {
      result.batches += 1;
      push({ table: ref, rows: count, tablesDone: index, tablesTotal: targets.length });
    });
    result.tables.push({ ref, rows });
  }
  result.status = "restored";
  return result;
}

/** MongoDB restore (13 §13.6): per collection, `deleteMany({})` then unordered batches; no atomicity. */
export function checkout(handle: MongoHandle, topology: Topology, plan: CheckoutPlan): CheckoutRun {
  const progress: CheckoutProgress[] = [];
  let wake: (() => void) | null = null;
  let finished = false;
  const push = (item: CheckoutProgress): void => {
    progress.push(item);
    wake?.();
  };
  const run = async (): Promise<CheckoutResult> => {
    try {
      return await restoreAll(handle, topology, plan, push);
    } catch (cause: unknown) {
      throw translate(cause, "checkout");
    } finally {
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

export type { EngineWarning };
