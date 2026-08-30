import { inferForeignKeys } from "./relations.ts";
import type { Introspection, JsonObject, ProbeResult, TableSchema } from "@testate/shared";
import { jsonObjectSchema } from "@testate/shared";
import * as v from "valibot";

import { sha256 } from "../../password/index.ts";
import { compareKeys } from "../../snapshot/merge.ts";
import { computeFingerprint } from "../pure/fingerprint.ts";
import { decodeOffsetCursor } from "../pure/page.ts";
import { fakeImportRows, fakeWriteRows } from "./write.ts";
import { EngineError, rowText, sameTable, tableKey } from "../types.ts";
import type {
  CheckoutProgress,
  CheckoutResult,
  ConnectionRef,
  DbEngine,
  EncodedRow,
  RowChunk,
  SnapshotManifest,
  SortKey,
} from "../types.ts";

/** One in-memory database: rows per `schema.table`, keyed by the adapter's `database` name. */
export type FakeDatabase = Map<string, JsonObject[]>;

export type FakeEngineOptions = {
  databases: Map<string, FakeDatabase>;
  version?: string;
  /** When set, every checkout fails with this engine error kind. */
  failCheckout?: "schema_drift" | "checkout_blocked" | "unreachable" | "lock_timeout";
  /** When set, checkouts report one failed counter until `repairCounters` runs. */
  failCounters?: { current: boolean };
  /** Tables keyed by row hash rather than primary key, the way a table without a key is read. */
  rowHashTables?: Set<string>;
};

const PROBE: Omit<ProbeResult, "version"> = {
  engine: "postgres",
  dialect: "postgres",
  meets_floor: true,
  floor: "13",
  tier: "tabular",
  capabilities: {
    canTruncate: true,
    canDisableTriggers: false,
    canTerminateSessions: true,
    supportsDeferrableConstraints: false,
    transactionalRestore: true,
    snapshotRead: "repeatable-read",
    timeSeriesDeletes: false,
  },
  strategy: {
    emptyMode: "truncate",
    foreignKeyHandling: "dependency-order",
    transactional: true,
    triggerDisable: false,
    locking: "table",
  },
  read_only_enforcement: "transaction",
  table_count: 0,
  size_estimate_bytes: 0,
  atomicity_notice: "fake",
  warnings: [],
};

/** Column names survive an emptied table, so a restore test does not read as schema drift. */
const KNOWN_COLUMNS = new WeakMap<FakeDatabase, Map<string, string[]>>();

function columnsOf(database: FakeDatabase | null, key: string, rows: JsonObject[]): string[] {
  const known =
    database === null ? null : (KNOWN_COLUMNS.get(database) ?? new Map<string, string[]>());
  const first = rows[0];
  const names = first === undefined ? (known?.get(key) ?? ["id"]) : Object.keys(first);
  if (database !== null && known !== null) {
    known.set(key, names);
    KNOWN_COLUMNS.set(database, known);
  }
  return names;
}

function schemaOf(
  key: string,
  rows: JsonObject[],
  database: FakeDatabase | null = null
): TableSchema {
  const dot = key.indexOf(".");
  const columns = columnsOf(database, key, rows).map((name) => ({
    name,
    type: "text",
    nullable: true,
    has_default: false,
    generated: false,
    identity: false,
    policy: { required_function: null, mask: null },
  }));
  return {
    schema: dot === -1 ? null : key.slice(0, dot),
    name: dot === -1 ? key : key.slice(dot + 1),
    kind: "table",
    row_estimate: rows.length,
    columns,
    primary_key: columns.some((column) => column.name === "id") ? ["id"] : null,
    foreign_keys_out: [],
    foreign_keys_in: [],
    unique: [],
    unsupported: [],
    excluded: false,
    display_column: null,
  };
}

function introspection(database: FakeDatabase): Introspection {
  const tables = [...database.entries()].map(([key, rows]) => schemaOf(key, rows, database));
  inferForeignKeys(tables);
  const result: Introspection = {
    tier: "tabular",
    fingerprint: "",
    tables,
    views: [],
    warnings: [],
  };
  result.fingerprint = computeFingerprint(result);
  return result;
}

function encode(rows: JsonObject[], byRowHash: boolean): EncodedRow[] {
  const keyed = rows.map((row) => {
    const json = rowText(JSON.stringify(row));
    const key: SortKey = byRowHash
      ? { by: "row-hash", value: sha256(json) }
      : { by: "primary-key", value: [v.parse(v.union([v.number(), v.string()]), row["id"])] };
    return { key, json };
  });
  // Both readers hand the merge its rows in key order.
  return keyed.sort((a, b) => compareKeys(a.key, b.key));
}

/** Map-backed engine for module tests (12 §12.9): snapshots read the map, checkouts replace it. */
export function createFakeEngine(opts: FakeEngineOptions): DbEngine {
  const version = opts.version ?? "16.3";
  const databaseOf = (conn: ConnectionRef): FakeDatabase => {
    const found = opts.databases.get(conn.config.database);
    if (found === undefined)
      throw new EngineError("unreachable", `${conn.config.database} is down`);
    return found;
  };
  return {
    async probe(config) {
      if (!opts.databases.has(config.database)) {
        throw new EngineError("unreachable", `${config.database} is down`);
      }
      return { ...PROBE, version, table_count: opts.databases.get(config.database)?.size ?? 0 };
    },
    async introspect(conn) {
      return introspection(databaseOf(conn));
    },
    snapshot(conn) {
      const database = databaseOf(conn);
      const live = introspection(database);
      const byRowHash = (table: { schema: string | null; name: string }): boolean =>
        opts.rowHashTables?.has(tableKey(table)) ?? false;
      const manifest: SnapshotManifest = {
        introspection: live,
        fingerprint: live.fingerprint,
        engineVersion: version,
        consistency: "snapshot",
        tables: live.tables.map((table) => ({
          ref: { schema: table.schema, name: table.name },
          rows: table.row_estimate,
          bytes: 0,
          sort: byRowHash(table) ? "row-hash" : "primary-key",
          warnings: [],
        })),
        warnings: [],
      };
      return {
        manifest: Promise.resolve(manifest),
        async *[Symbol.asyncIterator]() {
          for (const table of live.tables) {
            const rows = encode(database.get(tableKey(table)) ?? [], byRowHash(table));
            const chunk: RowChunk = {
              table: { schema: table.schema, name: table.name },
              rows,
              bytes: rows.reduce((total, row) => total + row.json.length, 0),
            };
            yield chunk;
          }
        },
        async [Symbol.asyncDispose]() {
          return;
        },
      };
    },
    checkout(conn, plan) {
      const progress: CheckoutProgress[] = [];
      const run = async (): Promise<CheckoutResult> => {
        const database = databaseOf(conn);
        if (opts.failCheckout !== undefined) {
          // A lock timeout names its blockers like the real engines do (story 85).
          const details =
            opts.failCheckout === "lock_timeout" ? { blocking_sessions: ["42", "dead-1"] } : {};
          throw new EngineError(
            opts.failCheckout,
            `fake checkout failed: ${opts.failCheckout}`,
            details,
            opts.failCheckout === "lock_timeout"
          );
        }
        const live = introspection(database);
        if (
          live.fingerprint !== plan.introspectionAtSnapshot.fingerprint &&
          plan.onDrift === "fail"
        ) {
          throw new EngineError("schema_drift", "the live schema differs from the state");
        }
        const tables: CheckoutResult["tables"] = [];
        for (const table of plan.tables) {
          const ref = { schema: table.schema, name: table.name };
          const rows: JsonObject[] = [];
          for await (const row of plan.rows(ref))
            rows.push(v.parse(jsonObjectSchema, JSON.parse(row.json)));
          database.set(tableKey(ref), rows);
          tables.push({ ref, rows: rows.length });
          progress.push({
            table: ref,
            rows: rows.length,
            tablesDone: tables.length,
            tablesTotal: plan.tables.length,
          });
        }
        return {
          status: "restored",
          strategy: PROBE.strategy,
          tables,
          skipped: { tables: [], columns: [] },
          defaultedColumns: [],
          counters:
            opts.failCounters?.current === true
              ? [{ name: "orders_id_seq", ok: false, error: "fake" }]
              : [],
          lockWaitMs: 0,
          batches: tables.length,
          warnings: [],
        };
      };
      const result = run();
      return {
        result,
        async *[Symbol.asyncIterator]() {
          await result.catch(() => undefined);
          yield* progress;
        },
      };
    },
    repairCounters: async () => {
      if (opts.failCounters !== undefined) opts.failCounters.current = false;
      return { counters: [{ name: "orders_id_seq", ok: true }] };
    },
    async *readTable(conn, table) {
      const database = databaseOf(conn);
      const found = [...database.keys()].find((key) => sameTable(schemaOf(key, []), table));
      const rows = encode(found === undefined ? [] : (database.get(found) ?? []), false);
      yield { table, rows, bytes: 0 };
    },
    async pageRows(conn, query) {
      const database = databaseOf(conn);
      const rows = [...(database.get(tableKey(query.table)) ?? [])];
      const compare = (a: JsonObject, b: JsonObject): number =>
        String(a[query.sort ?? "id"] ?? "").localeCompare(
          String(b[query.sort ?? "id"] ?? ""),
          undefined,
          { numeric: true }
        );
      rows.sort((a, b) => (query.order === "desc" ? -compare(a, b) : compare(a, b)));
      const filtered = rows.filter((row) =>
        query.filters.every(
          (filter) => filter.op !== "eq" || String(row[filter.column]) === filter.value
        )
      );
      const offset = decodeOffsetCursor(query.cursor);
      const page = filtered.slice(offset, offset + query.limit);
      return {
        rows: page.map((row) => rowText(JSON.stringify(row))),
        columns: Object.keys(filtered[0] ?? { id: 1 }).map((name) => ({ name, type: "text" })),
        nextCursor: filtered.length > offset + query.limit ? String(offset + query.limit) : null,
        kind: "offset",
      };
    },
    writeRows: async (conn, table, ops) => fakeWriteRows(databaseOf(conn), table, ops),
    importRows: async (conn, table, rows, opts) =>
      fakeImportRows(databaseOf(conn), table, rows, opts),
    /** Reads `SELECT * FROM <table>`; anything else answers as a write with one affected row. */
    async runQuery(conn, query, opts) {
      const database = databaseOf(conn);
      const match = /^\s*SELECT \* FROM ([\w.]+)/i.exec(query.text);
      if (match === null) {
        if (opts.mode === "read")
          throw new EngineError("batch_failed", "cannot execute in a read-only transaction");
        return { columns: [], rows: [], rowsAffected: 1, truncated: false, durationMs: 1 };
      }
      const rows = database.get(match[1] ?? "") ?? [];
      return {
        columns: Object.keys(rows[0] ?? {}),
        rows: rows.slice(0, opts.rowCap).map((row) => rowText(JSON.stringify(row))),
        rowsAffected: null,
        truncated: rows.length > opts.rowCap,
        durationMs: 1,
      };
    },
    listRunningQueries: async () => [],
    cancelQuery: async () => undefined,
    terminateSessions: async (_conn, ids) => ({
      terminated: ids.filter((id) => !id.startsWith("dead-")),
      failed: ids.filter((id) => id.startsWith("dead-")),
    }),
    decodeRow: (row) => v.parse(jsonObjectSchema, JSON.parse(row)),
    evict: async () => undefined,
  };
}
