import type {
  Capabilities,
  EngineWarning,
  Introspection,
  JsonObject,
  JsonValue,
  ManifestTable,
  ProbeResult,
  RestoreStrategy,
  SchemaDrift,
  TableRef,
} from "@testate/shared";

export type { Capabilities, Introspection, ProbeResult, RestoreStrategy, SchemaDrift, TableRef };

/** Decrypted connection details; they enter the engine and never leave (12 §12.8). */
export type PostgresConfig = {
  engine: "postgres";
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: "disable" | "prefer" | "require";
  schemas?: string[];
};

/** MariaDB is a dialect the probe reports; the config carries the adapter's engine name (ADR 0001). */
export type MysqlConfig = {
  engine: "mysql" | "mariadb";
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: "disable" | "prefer" | "require";
};

/** Field form authenticates against `admin` (the container default); a connection string names its own `authSource`. */
export type MongodbConfig = {
  engine: "mongodb";
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: "disable" | "prefer" | "require";
  authSource: string;
};

export type ConnectionConfig = PostgresConfig | MysqlConfig | MongodbConfig;

export type ConnectionRef = { connectionId: string; config: ConnectionConfig };

/** Server-serialized JSON text of one row; never parsed on the way to a blob (ADR 0001). */
export type RowText = string & { readonly __rowText: unique symbol };

export type SortKey = { by: "primary-key"; value: JsonValue[] } | { by: "row-hash"; value: string };

export type EncodedRow = { key: SortKey; json: RowText };

export type RowChunk = { table: TableRef; rows: EncodedRow[]; bytes: number };

export type ManifestEntry = {
  ref: TableRef;
  rows: number;
  bytes: number;
  sort: "primary-key" | "row-hash";
  warnings: EngineWarning[];
};

export type SnapshotManifest = {
  introspection: Introspection;
  fingerprint: string;
  engineVersion: string;
  consistency: "snapshot" | "best_effort";
  tables: ManifestEntry[];
  warnings: EngineWarning[];
};

export type SnapshotOptions = {
  excludeTables: TableRef[];
  schemas?: string[];
  chunkRows?: number;
  signal?: AbortSignal;
};

/** Pull-driven: nothing happens until drained; dispose to abandon (ADR 0001). */
export type SnapshotRun = AsyncIterable<RowChunk> &
  AsyncDisposable & { readonly manifest: Promise<SnapshotManifest> };

export type CheckoutPlan = {
  tables: ManifestTable[];
  introspectionAtSnapshot: Introspection;
  rows: (table: TableRef) => AsyncIterable<EncodedRow>;
  onDrift: "fail" | "force";
  foreignKeyChecks?: boolean;
  lockTimeoutMs: number;
  restoreMode: "atomic" | "fast";
  signal?: AbortSignal;
};

export type CheckoutProgress = {
  table: TableRef;
  rows: number;
  tablesDone: number;
  tablesTotal: number;
};

export type ColumnRef = { table: TableRef; column: string };

export type CounterResult = { name: string; ok: boolean; error?: string };

export type CheckoutResult = {
  status: "restored" | "rolled_back" | "unknown";
  strategy: RestoreStrategy;
  tables: { ref: TableRef; rows: number }[];
  skipped: { tables: TableRef[]; columns: ColumnRef[] };
  defaultedColumns: ColumnRef[];
  counters: CounterResult[];
  lockWaitMs: number;
  batches: number;
  warnings: EngineWarning[];
};

/** Push-driven: starts on call; `result` settles whether or not progress is read (ADR 0001). */
export type CheckoutRun = AsyncIterable<CheckoutProgress> & {
  readonly result: Promise<CheckoutResult>;
};

export type CounterReport = { counters: CounterResult[] };

export type ReadOptions = { chunkRows?: number; signal?: AbortSignal };

export type FilterOp = "eq" | "ne" | "lt" | "le" | "gt" | "ge" | "like" | "in" | "null" | "notnull";
export type RowFilter = { column: string; op: FilterOp; value: string };

/** One grid page (06 §6.2): keyset on the primary key when there is one, else offset. */
export type PageQuery = {
  table: TableRef;
  limit: number;
  cursor?: string;
  sort?: string;
  order: "asc" | "desc";
  filters: RowFilter[];
};

/** A cell on the way in: a plain JSON value or the column default (24 §24.2, functions already applied). */
export type RowValue = { kind: "value"; value: JsonValue } | { kind: "default" };
export type RowValues = Record<string, RowValue>;

export type RowOp =
  | { kind: "insert"; values: RowValues }
  | { kind: "update"; pk: JsonObject; values: RowValues }
  | { kind: "delete"; pk: JsonObject };

export type RowOpResult = { kind: RowOp["kind"]; pk: JsonObject; row: RowText | null };

export type WriteOptions = { foreignKeyChecks: boolean; signal?: AbortSignal };

/** One import batch (19 §19.3): rows already transformed; the mode decides the statement. */
export type ImportOptions = {
  mode: "append" | "upsert" | "replace";
  keyColumns: string[];
  foreignKeyChecks: boolean;
  /** `replace` empties the table before the first batch only. */
  firstBatch: boolean;
  signal?: AbortSignal;
};

export type ImportRowFailure = { index: number; message: string };
export type ImportBatchResult = { inserted: number; updated: number; failures: ImportRowFailure[] };

export type RowsPageResult = {
  rows: RowText[];
  columns: { name: string; type: string }[];
  nextCursor: string | null;
  kind: "keyset" | "offset";
};

export type EngineQuery = { text: string };

export type QueryOptions = {
  mode: "read" | "write";
  rowCap: number;
  byteBudget: number;
  timeBudgetMs: number;
  queryId: string;
  signal?: AbortSignal;
};

export type QueryResult = {
  columns: string[];
  rows: RowText[];
  rowsAffected: number | null;
  truncated: boolean;
  durationMs: number;
};

export type TerminateResult = { terminated: string[]; failed: string[] };

export type RunningQuery = { pid: string; startedAt: string; text: string; state: string };

export type DisplayRow = JsonObject;

export type EngineErrorKind =
  | "unreachable"
  | "auth_failed"
  | "version_too_old"
  | "privilege_missing"
  | "schema_drift"
  | "checkout_blocked"
  | "lock_timeout"
  | "cancelled"
  | "batch_failed"
  | "document_too_large"
  | "unsupported";

/** The only error an engine lets out; callers branch on `kind`, never on driver text. */
export class EngineError extends Error {
  readonly kind: EngineErrorKind;
  readonly details: JsonObject;
  readonly retriable: boolean;

  constructor(kind: EngineErrorKind, message: string, details: JsonObject = {}, retriable = false) {
    super(message);
    this.name = "EngineError";
    this.kind = kind;
    this.details = details;
    this.retriable = retriable;
  }
}

/** The engine port (ADR 0001). Each engine folder implements it; the registry hands one out per engine. */
export type DbEngine = {
  probe(config: ConnectionConfig): Promise<ProbeResult>;
  introspect(conn: ConnectionRef, excluded: TableRef[]): Promise<Introspection>;
  snapshot(conn: ConnectionRef, opts: SnapshotOptions): SnapshotRun;
  checkout(conn: ConnectionRef, plan: CheckoutPlan): CheckoutRun;
  repairCounters(conn: ConnectionRef, tables: TableRef[]): Promise<CounterReport>;
  readTable(conn: ConnectionRef, table: TableRef, opts: ReadOptions): AsyncIterable<RowChunk>;
  pageRows(conn: ConnectionRef, query: PageQuery): Promise<RowsPageResult>;
  /** Every op in one transaction; a failure rolls back and names the op index (06 §6.6). */
  writeRows(
    conn: ConnectionRef,
    table: TableRef,
    ops: RowOp[],
    opts: WriteOptions
  ): Promise<RowOpResult[]>;
  /** A batch failure is retried row by row so the failing rows are named (19 §19.3 step 5). */
  importRows(
    conn: ConnectionRef,
    table: TableRef,
    rows: RowValues[],
    opts: ImportOptions
  ): Promise<ImportBatchResult>;
  runQuery(conn: ConnectionRef, query: EngineQuery, opts: QueryOptions): Promise<QueryResult>;
  listRunningQueries(conn: ConnectionRef): Promise<RunningQuery[]>;
  cancelQuery(conn: ConnectionRef, queryId: string): Promise<void>;
  /** Ends the sessions that blocked a checkout (09 §9.5); needs `canTerminateSessions` from the probe. */
  terminateSessions(conn: ConnectionRef, sessionIds: string[]): Promise<TerminateResult>;
  decodeRow(row: RowText): DisplayRow;
  /** Drops pooled connections for a connection record (credential or target change). */
  evict(connectionId: string): Promise<void>;
};

export function tableKey(ref: TableRef): string {
  return ref.schema === null ? ref.name : `${ref.schema}.${ref.name}`;
}

export function sameTable(a: TableRef, b: TableRef): boolean {
  return a.schema === b.schema && a.name === b.name;
}

/** Brands server-produced JSON text; the only place a string becomes RowText. */
export function rowText(text: string): RowText {
  // SAFETY: callers pass text the database serialized (to_jsonb) or the codec read back verbatim.
  return text as RowText;
}
