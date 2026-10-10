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
import { cancelQuery, listRunningQueries, pageRows, runQuery, terminateSessions } from "./query.ts";
import { readCollection, snapshot } from "./reader.ts";
import { checkout } from "./restore.ts";
import { readServerLog } from "./serverlog.ts";

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
  type Conn = Parameters<DbEngine["introspect"]>[0];
  type Opened = { handle: MongoHandle; topology: Topology; release: () => Promise<void> };
  /** A leased client and the server's topology; the caller releases the lease when done. */
  const open = async (conn: Conn): Promise<Opened> => {
    const { handle, release } = await clients.acquire(conn);
    try {
      let topology = topologies.get(conn.connectionId);
      if (topology === undefined) {
        topology = await guarded("hello", () => topologyOf(handle));
        topologies.set(conn.connectionId, topology);
      }
      return { handle, topology, release };
    } catch (cause: unknown) {
      await release();
      throw cause;
    }
  };
  /** One operation on a leased client, released however it ends. */
  const use = async <T>(conn: Conn, run: (opened: Opened) => Promise<T>): Promise<T> => {
    const opened = await open(conn);
    try {
      return await run(opened);
    } finally {
      await opened.release();
    }
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
      return use(conn, ({ handle, topology }) =>
        guarded("introspect", () => introspect(handle.db, excluded, topology.timeSeriesDeletes))
      );
    },
    snapshot(conn, opts): SnapshotRun {
      const pending = (async (): Promise<SnapshotRun & { release: () => Promise<void> }> => {
        const { handle, topology, release } = await open(conn);
        return Object.assign(snapshot(handle, topology, opts), { release });
      })();
      void swallow(pending);
      // The manifest is a second chain off `pending`: the job drains the stream first and reads
      // this afterwards, so a refused connection would reject it with nobody waiting, and Bun ends
      // the process on an unhandled rejection.
      const manifest = (async () => (await pending).manifest)();
      void swallow(manifest);
      return {
        manifest,
        async *[Symbol.asyncIterator]() {
          yield* await pending;
        },
        async [Symbol.asyncDispose]() {
          try {
            const run = await pending;
            try {
              await run[Symbol.asyncDispose]();
            } finally {
              await run.release();
            }
          } catch {
            return;
          }
        },
      };
    },
    checkout(conn, plan): CheckoutRun {
      const pending = (async (): Promise<CheckoutRun & { release: () => Promise<void> }> => {
        const { handle, topology, release } = await open(conn);
        return Object.assign(checkout(handle, topology, plan), { release });
      })();
      void swallow(pending);
      // A checkout has no dispose; its lease goes back once its result settles.
      const result = (async () => {
        const run = await pending;
        try {
          return await run.result;
        } finally {
          await run.release();
        }
      })();
      void swallow(result);
      return {
        result,
        async *[Symbol.asyncIterator]() {
          yield* await pending;
        },
      };
    },
    async repairCounters() {
      return { counters: [] };
    },
    async *readTable(conn, table, opts: ReadOptions) {
      const { handle, topology, release } = await open(conn);
      try {
        const live = await introspect(handle.db, [], topology.timeSeriesDeletes);
        const schema = live.tables.find((item) => item.name === table.name);
        if (schema === undefined)
          throw new EngineError("batch_failed", `collection ${table.name} not found`);
        const readOpts = { chunkRows: opts.chunkRows ?? 5000, signal: opts.signal };
        yield* readCollection(handle.db.collection(table.name), schema, readOpts);
      } finally {
        await release();
      }
    },
    async pageRows(conn, query) {
      return use(conn, ({ handle }) => guarded("rows", () => pageRows(handle, query)));
    },
    async writeRows() {
      throw unsupported("editing");
    },
    async importRows() {
      throw unsupported("import");
    },
    async runQuery(conn, query, opts) {
      return use(conn, ({ handle }) => guarded("query", () => runQuery(handle, query, opts)));
    },
    async listRunningQueries(conn) {
      return use(conn, ({ handle }) => guarded("list queries", () => listRunningQueries(handle)));
    },
    async readServerLog(conn, source, page) {
      return use(conn, ({ handle }) =>
        guarded("server log", () => readServerLog(handle, source, page))
      );
    },
    async cancelQuery(conn, queryId) {
      await use(conn, ({ handle }) => guarded("cancel", () => cancelQuery(handle, queryId)));
    },
    async terminateSessions(conn, ids) {
      return use(conn, ({ handle }) => guarded("terminate", () => terminateSessions(handle, ids)));
    },
    decodeRow,
    evict: (connectionId) => {
      topologies.delete(connectionId);
      return clients.evict(connectionId);
    },
  };
}

export type { SnapshotOptions };
