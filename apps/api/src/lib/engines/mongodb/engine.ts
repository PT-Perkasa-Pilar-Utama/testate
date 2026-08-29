import { EngineError } from "../types.ts";
import type { CheckoutRun, DbEngine, ReadOptions, SnapshotOptions, SnapshotRun } from "../types.ts";
import type { Netguard } from "../postgres/pool.ts";
import { swallow } from "../mysql/reader.ts";
import { connect, createMongoClientManager, guarded } from "./client.ts";
import type { MongoHandle } from "./client.ts";
import { decodeRow } from "./codec.ts";
import { introspect } from "./introspect.ts";
import { probe, topologyOf } from "./probe.ts";
import type { Topology } from "./probe.ts";
import { cancelQuery, listRunningQueries, pageRows, runQuery } from "./query.ts";
import { readCollection, snapshot } from "./reader.ts";
import { checkout } from "./restore.ts";

export { decodeRow } from "./codec.ts";

function unsupported(operation: string): EngineError {
  return new EngineError("unsupported", `${operation} is outside the Document tier`, {
    reason: "tier",
  });
}

/** MongoDB on the engine port (12 §12.1): view, state, diff, extract; no edits, no imports. */
export function createMongodbEngine(netguard: Netguard): DbEngine {
  const clients = createMongoClientManager(netguard);
  const topologies = new Map<string, Topology>();
  const open = async (
    conn: Parameters<DbEngine["introspect"]>[0]
  ): Promise<{ handle: MongoHandle; topology: Topology }> => {
    const handle = await clients.acquire(conn);
    let topology = topologies.get(conn.connectionId);
    if (topology === undefined) {
      topology = await guarded("hello", () => topologyOf(handle));
      topologies.set(conn.connectionId, topology);
    }
    return { handle, topology };
  };
  return {
    async probe(config) {
      if (config.engine !== "mongodb")
        throw new EngineError("unsupported", `${config.engine} is not mongodb`);
      const handle = await connect(config, netguard);
      try {
        return await guarded("probe", () => probe(handle));
      } finally {
        await handle.client.close();
      }
    },
    async introspect(conn, excluded) {
      const { handle, topology } = await open(conn);
      return guarded("introspect", () =>
        introspect(handle.db, excluded, topology.timeSeriesDeletes)
      );
    },
    snapshot(conn, opts): SnapshotRun {
      const pending = (async (): Promise<SnapshotRun> => {
        const { handle, topology } = await open(conn);
        return snapshot(handle, topology, opts);
      })();
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
      const pending = (async (): Promise<CheckoutRun> => {
        const { handle, topology } = await open(conn);
        return checkout(handle, topology, plan);
      })();
      void swallow(pending);
      return {
        result: (async () => (await pending).result)(),
        async *[Symbol.asyncIterator]() {
          yield* await pending;
        },
      };
    },
    async repairCounters() {
      return { counters: [] };
    },
    async *readTable(conn, table, opts: ReadOptions) {
      const { handle, topology } = await open(conn);
      const live = await introspect(handle.db, [], topology.timeSeriesDeletes);
      const schema = live.tables.find((item) => item.name === table.name);
      if (schema === undefined)
        throw new EngineError("batch_failed", `collection ${table.name} not found`);
      const readOpts = { chunkRows: opts.chunkRows ?? 5000, signal: opts.signal };
      yield* readCollection(handle.db.collection(table.name), schema, readOpts);
    },
    async pageRows(conn, query) {
      const { handle } = await open(conn);
      return guarded("rows", () => pageRows(handle, query));
    },
    async writeRows() {
      throw unsupported("editing");
    },
    async importRows() {
      throw unsupported("import");
    },
    async runQuery(conn, query, opts) {
      const { handle } = await open(conn);
      return guarded("query", () => runQuery(handle, query, opts));
    },
    async listRunningQueries(conn) {
      const { handle } = await open(conn);
      return guarded("list queries", () => listRunningQueries(handle));
    },
    async cancelQuery(conn, queryId) {
      const { handle } = await open(conn);
      await guarded("cancel", () => cancelQuery(handle, queryId));
    },
    decodeRow,
    evict: (connectionId) => {
      topologies.delete(connectionId);
      return clients.evict(connectionId);
    },
  };
}

export type { SnapshotOptions };
