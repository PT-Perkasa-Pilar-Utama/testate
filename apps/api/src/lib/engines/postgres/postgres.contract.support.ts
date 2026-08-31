import { SQL } from "bun";

import type { Netguard } from "./pool.ts";
import type { ManifestTable } from "@testate/shared";

import { rowText } from "../types.ts";
import type {
  ConnectionRef,
  EncodedRow,
  PostgresConfig,
  RowChunk,
  RowText,
  SnapshotManifest,
  TableRef,
} from "../types.ts";

/**
 * Contract test against `deploy/compose.engines.yml`. Skipped when the server is not reachable,
 * so `bun test` stays green on a laptop without Docker.
 */
export const CONFIG: PostgresConfig = {
  engine: "postgres",
  host: "127.0.0.1",
  port: 15432,
  database: "shop",
  user: "testate",
  password: "testate",
  ssl: "disable",
};
export const URL = `postgres://${CONFIG.user}:${CONFIG.password}@${CONFIG.host}:${CONFIG.port}/${CONFIG.database}`;

export async function reachable(): Promise<boolean> {
  const sql = new SQL({ url: URL, connectionTimeout: 2, max: 1 });
  try {
    await sql.unsafe("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await sql.close();
  }
}

export const FIXTURE = `
  DROP SCHEMA IF EXISTS contract CASCADE;
  CREATE SCHEMA contract;
  CREATE TABLE contract.customers (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email text NOT NULL UNIQUE,
    balance numeric(24,4) NOT NULL DEFAULT 0,
    big bigint NOT NULL DEFAULT 0
  );
  CREATE TABLE contract.orders (
    id serial PRIMARY KEY,
    customer_id bigint NOT NULL REFERENCES contract.customers(id),
    total numeric(12,2) NOT NULL,
    placed_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE contract.notes (body text NOT NULL);
  INSERT INTO contract.customers (email, balance, big) VALUES
    ('a@x.io', 12345678901234567.8901, 9007199254740993),
    ('b@x.io', 1.5, 1);
  INSERT INTO contract.orders (customer_id, total) VALUES (1, 10.00), (1, 20.50), (2, 5.25);
  INSERT INTO contract.notes VALUES ('one'), ('two'), ('two');
`;

export const netguard: Netguard = {
  check: async () => ({ allowed: true, addresses: ["127.0.0.1"] }),
};
export const conn: ConnectionRef = {
  connectionId: "contract",
  config: { ...CONFIG, schemas: ["contract"] },
};

export async function collect(run: AsyncIterable<RowChunk>): Promise<Map<string, EncodedRow[]>> {
  const rows = new Map<string, EncodedRow[]>();
  for await (const chunk of run) {
    const key = `${chunk.table.schema}.${chunk.table.name}`;
    rows.set(key, [...(rows.get(key) ?? []), ...chunk.rows]);
  }
  return rows;
}

export function firstRow(rows: Map<string, EncodedRow[]>, key: string): RowText {
  const first = rows.get(key)?.[0];
  return first === undefined ? rowText("{}") : first.json;
}

export function planTables(manifest: SnapshotManifest): ManifestTable[] {
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

export function firstOf(rows: RowText[]): RowText {
  const first = rows[0];
  if (first === undefined) throw new Error("empty page");
  return first;
}

export function cursorOf(page: { nextCursor: string | null }): string {
  if (page.nextCursor === null) throw new Error("no next page");
  return page.nextCursor;
}

export function rowsFrom(
  saved: Map<string, EncodedRow[]>
): (table: TableRef) => AsyncIterable<EncodedRow> {
  return async function* (table) {
    yield* saved.get(`${table.schema}.${table.name}`) ?? [];
  };
}

export function rowOf(results: { row: RowText | null }[], index: number): RowText {
  const row = results[index]?.row;
  if (row === undefined || row === null) throw new Error(`result ${index} has no row`);
  return row;
}
