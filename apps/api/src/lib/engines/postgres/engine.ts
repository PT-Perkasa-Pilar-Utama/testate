import type { TableRef } from "@testate/shared";
import { jsonObjectSchema } from "@testate/shared";
import * as v from "valibot";

import { preciseNumbersAsText } from "../pure/display.ts";
import { EngineError, sameTable } from "../types.ts";
import type {
  CheckoutRun,
  ConnectionRef,
  DbEngine,
  DisplayRow,
  RowText,
  SnapshotRun,
} from "../types.ts";
import { guarded } from "./errors.ts";
import { introspect } from "./introspect.ts";
import { connect, createPoolManager } from "./pool.ts";
import type { Netguard } from "./pool.ts";
import { probe } from "./probe.ts";
import {
  cancelQuery,
  createCancelChannel,
  listRunningQueries,
  runQuery,
  terminateSessions,
} from "./query.ts";
import { readTable, snapshot, swallow } from "./reader.ts";
import { checkout, resetCounters } from "./restore.ts";
import { importRows } from "./import.ts";
import { pageRows } from "./rows.ts";
import { writeRows } from "./write.ts";

/** Schemas only exist on the postgres config; the union narrows here once. */
function schemasOf(config: ConnectionRef["config"]): string[] | undefined {
  return config.engine === "postgres" ? config.schemas : undefined;
}

/** Big integers and decimals stay text so the SPA never rounds them (12 §12.4). */
export function decodeRow(row: RowText): DisplayRow {
  return v.parse(jsonObjectSchema, JSON.parse(preciseNumbersAsText(row)));
}

export function createPostgresEngine(netguard: Netguard): DbEngine {
  const pools = createPoolManager(netguard);
  const cancel = createCancelChannel();
  return {
    async probe(config) {
      if (config.engine !== "postgres")
        throw new EngineError("unsupported", `${config.engine} is not postgres`);
      const sql = await connect(config, netguard, 2);
      try {
        return await guarded("probe", () => probe(sql));
      } finally {
        await sql.close();
      }
    },
    async introspect(conn, excluded) {
      const sql = await pools.acquire(conn);
      return guarded("introspect", () => introspect(sql, excluded, schemasOf(conn.config)));
    },
    snapshot(conn, opts): SnapshotRun {
      // Acquiring the pool is the only async prelude; the run reserves its own connection when drained.
      const pending = (async (): Promise<SnapshotRun> =>
        snapshot(await pools.acquire(conn), opts))();
      void swallow(pending);
      return {
        manifest: (async () => (await pending).manifest)(),
        async *[Symbol.asyncIterator]() {
          yield* await pending;
        },
        async [Symbol.asyncDispose]() {
          try {
            const run = await pending;
            await run[Symbol.asyncDispose]();
          } catch {
            return;
          }
        },
      };
    },
    checkout(conn, plan): CheckoutRun {
      const pending = (async (): Promise<CheckoutRun> =>
        checkout(await pools.acquire(conn), plan))();
      void swallow(pending);
      return {
        result: (async () => (await pending).result)(),
        async *[Symbol.asyncIterator]() {
          yield* await pending;
        },
      };
    },
    async repairCounters(conn, tables) {
      const sql = await pools.acquire(conn);
      return { counters: await guarded("counters", () => resetCounters(sql, tables)) };
    },
    // ponytail: readTable snapshots every table and keeps one. Fine for the grid on small
    // databases; give it its own cursor before the data card pages large tables.
    async *readTable(conn, table, opts) {
      const sql = await pools.acquire(conn);
      const live = await introspect(sql, [], schemasOf(conn.config));
      const found = live.tables.find((item) => sameTable(item, table));
      if (found === undefined)
        throw new EngineError("batch_failed", `table ${table.name} not found`);
      yield* readTable(sql, found, opts.chunkRows);
    },
    async pageRows(conn, query) {
      const sql = await pools.acquire(conn);
      return guarded("rows", () => pageRows(sql, query, schemasOf(conn.config)));
    },
    async importRows(conn, table, rows, opts) {
      const sql = await pools.acquire(conn);
      return guarded("import", () => importRows(sql, table, rows, opts, schemasOf(conn.config)));
    },
    async writeRows(conn, table, ops, opts) {
      const sql = await pools.acquire(conn);
      return guarded("edit", () => writeRows(sql, table, ops, opts, schemasOf(conn.config)));
    },
    async runQuery(conn, query, opts) {
      const sql = await pools.acquire(conn);
      return runQuery(sql, conn.connectionId, cancel, query, opts);
    },
    async listRunningQueries(conn) {
      const sql = await pools.acquire(conn);
      return guarded("list queries", () => listRunningQueries(sql));
    },
    async cancelQuery(conn, queryId) {
      const sql = await pools.acquire(conn);
      await guarded("cancel", () => cancelQuery(sql, conn.connectionId, cancel, queryId));
    },
    async terminateSessions(conn, ids) {
      const sql = await pools.acquire(conn);
      return guarded("terminate", () => terminateSessions(sql, ids));
    },
    decodeRow,
    evict: (connectionId) => pools.evict(connectionId),
  };
}

export type { TableRef };
