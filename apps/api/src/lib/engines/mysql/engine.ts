import { jsonObjectSchema } from "@testate/shared";
import * as v from "valibot";

import { preciseNumbersAsText } from "../pure/display.ts";
import { EngineError, sameTable } from "../types.ts";
import type {
  CheckoutRun,
  DbEngine,
  DisplayRow,
  RowText,
  SnapshotOptions,
  SnapshotRun,
} from "../types.ts";
import { createCancelChannel } from "../postgres/query.ts";
import type { Netguard } from "../postgres/pool.ts";
import { guarded } from "./errors.ts";
import { introspect } from "./introspect.ts";
import { connect, createMysqlPoolManager } from "./pool.ts";
import { dialectOf, probe } from "./probe.ts";
import { cancelQuery, listRunningQueries, runQuery, terminateSessions } from "./query.ts";
import { snapshot, swallow } from "./reader.ts";
import { checkout, resetCounters } from "./restore.ts";
import { pageRows } from "./rows.ts";
import { importRows, writeRows } from "./write.ts";

export function decodeRow(row: RowText): DisplayRow {
  return v.parse(jsonObjectSchema, JSON.parse(preciseNumbersAsText(row)));
}

const versionRow = v.object({ v: v.string() });

/** MySQL and MariaDB share one engine; the dialect decides the timeout variable (ADR 0001). */
export function createMysqlEngine(netguard: Netguard): DbEngine {
  const pools = createMysqlPoolManager(netguard);
  const cancel = createCancelChannel();
  const dialects = new Map<string, "mysql" | "mariadb">();
  const dialectFor = async (
    connectionId: string,
    sql: Awaited<ReturnType<typeof pools.acquire>>
  ): Promise<"mysql" | "mariadb"> => {
    const known = dialects.get(connectionId);
    if (known !== undefined) return known;
    const version = v.parse(versionRow, (await sql.unsafe("SELECT VERSION() AS v"))[0]).v;
    const dialect = dialectOf(version).name;
    dialects.set(connectionId, dialect);
    return dialect;
  };
  return {
    async probe(config) {
      if (config.engine !== "mysql" && config.engine !== "mariadb")
        throw new EngineError("unsupported", `${config.engine} is not mysql`);
      const sql = await connect(config, netguard, 2);
      try {
        return await guarded("probe", () => probe(sql));
      } finally {
        await sql.close();
      }
    },
    async introspect(conn, excluded) {
      const sql = await pools.acquire(conn);
      return guarded("introspect", () => introspect(sql, excluded));
    },
    snapshot(conn, opts): SnapshotRun {
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
      const live = await introspect(sql, []);
      return { counters: await guarded("counters", () => resetCounters(sql, tables, live)) };
    },
    async *readTable(conn, table, opts) {
      const sql = await pools.acquire(conn);
      const live = await introspect(sql, []);
      if (!live.tables.some((item) => sameTable(item, { schema: null, name: table.name }))) {
        throw new EngineError("batch_failed", `table ${table.name} not found`);
      }
      const options: SnapshotOptions = { excludeTables: [] };
      if (opts.chunkRows !== undefined) options.chunkRows = opts.chunkRows;
      const run = snapshot(sql, options);
      for await (const chunk of run) {
        if (chunk.table.name === table.name) yield chunk;
      }
    },
    async pageRows(conn, query) {
      const sql = await pools.acquire(conn);
      return guarded("rows", () => pageRows(sql, query));
    },
    async writeRows(conn, table, ops, opts) {
      const sql = await pools.acquire(conn);
      return guarded("edit", () => writeRows(sql, table, ops, opts));
    },
    async importRows(conn, table, rows, opts) {
      const sql = await pools.acquire(conn);
      return guarded("import", () => importRows(sql, table, rows, opts));
    },
    async runQuery(conn, query, opts) {
      const sql = await pools.acquire(conn);
      return runQuery(
        sql,
        await dialectFor(conn.connectionId, sql),
        conn.connectionId,
        cancel,
        query,
        opts
      );
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
    evict: (connectionId) => {
      dialects.delete(connectionId);
      return pools.evict(connectionId);
    },
  };
}
