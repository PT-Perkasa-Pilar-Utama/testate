/**
 * `bun:sqlite` for the demo (#demo), over sql.js. Only the surface the API's repositories use:
 * `query(sql).get/all/run`, `run`, `exec`, `transaction(fn)` and `close`. sql.js loads its wasm
 * asynchronously, so the demo hands it over with `useSqlite` before anything opens a database.
 */
import type { BindParams, Database as SqlJsDatabase, SqlJsStatic, SqlValue } from "sql.js";
import * as v from "valibot";

let engine: SqlJsStatic | null = null;

export function useSqlite(loaded: SqlJsStatic): void {
  engine = loaded;
}

const scalarSchema = v.union([
  v.string(),
  v.number(),
  v.bigint(),
  v.boolean(),
  v.null(),
  v.undefined(),
  v.instance(Uint8Array),
]);
type Scalar = v.InferOutput<typeof scalarSchema>;
const namedSchema = v.record(v.string(), scalarSchema);
type Named = v.InferOutput<typeof namedSchema>;
type Param = Scalar | Named;
type Row = Record<string, SqlValue>;
type RunResult = { changes: number; lastInsertRowid: number };
type SqliteOptions = { create?: boolean; strict?: boolean };

function value(param: Scalar): SqlValue {
  if (param === undefined || param === null) return null;
  if (param === true) return 1;
  if (param === false) return 0;
  if (v.is(v.bigint(), param)) return Number(param);
  return param;
}

/** Positional values, or one object whose bare keys name `$key`, `:key` or `@key` in the SQL. */
function bindings(sql: string, params: Param[]): BindParams {
  const named = params.length === 1 ? v.safeParse(namedSchema, params[0]) : null;
  if (named === null || !named.success || params[0] instanceof Uint8Array)
    return params.map((param) => value(v.parse(scalarSchema, param)));
  const bound: Record<string, SqlValue> = {};
  for (const [key, raw] of Object.entries(named.output)) {
    const prefix = ["$", ":", "@"].find((mark) => sql.includes(`${mark}${key}`)) ?? "$";
    bound[`${prefix}${key}`] = value(raw);
  }
  return bound;
}

class Statement {
  constructor(
    private readonly db: SqlJsDatabase,
    private readonly sql: string
  ) {}

  private rows(params: Param[], limit: number): Row[] {
    const statement = this.db.prepare(this.sql);
    try {
      statement.bind(bindings(this.sql, params));
      const rows: Row[] = [];
      while (rows.length < limit && statement.step()) rows.push(statement.getAsObject());
      return rows;
    } finally {
      statement.free();
    }
  }

  get(...params: Param[]): Row | null {
    return this.rows(params, 1)[0] ?? null;
  }

  all(...params: Param[]): Row[] {
    return this.rows(params, Number.POSITIVE_INFINITY);
  }

  run(...params: Param[]): RunResult {
    this.db.run(this.sql, bindings(this.sql, params));
    const changes = this.db.getRowsModified();
    const id = this.db.exec("SELECT last_insert_rowid() AS id")[0]?.values[0]?.[0];
    return { changes, lastInsertRowid: Number(id ?? 0) };
  }
}

export class Database {
  private readonly db: SqlJsDatabase;
  private depth = 0;

  constructor(_path?: string, _options?: SqliteOptions) {
    if (engine === null) throw new Error("the demo opened a database before sql.js loaded");
    this.db = new engine.Database();
  }

  query(sql: string): Statement {
    return new Statement(this.db, sql);
  }

  prepare(sql: string): Statement {
    return this.query(sql);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  run(sql: string, params: Param[] = []): RunResult {
    return this.query(sql).run(...params);
  }

  /** As bun:sqlite: the outermost call is a transaction, an inner one a savepoint. */
  transaction<TArgs extends Param[], TResult>(
    run: (...args: TArgs) => TResult
  ): (...args: TArgs) => TResult {
    return (...args: TArgs): TResult => {
      const name = `sp${this.depth}`;
      this.db.exec(this.depth === 0 ? "BEGIN" : `SAVEPOINT ${name}`);
      this.depth += 1;
      try {
        const result = run(...args);
        this.depth -= 1;
        this.db.exec(this.depth === 0 ? "COMMIT" : `RELEASE ${name}`);
        return result;
      } catch (cause) {
        this.depth -= 1;
        this.db.exec(this.depth === 0 ? "ROLLBACK" : `ROLLBACK TO ${name}; RELEASE ${name}`);
        throw cause;
      }
    };
  }

  close(): void {
    this.db.close();
  }
}
