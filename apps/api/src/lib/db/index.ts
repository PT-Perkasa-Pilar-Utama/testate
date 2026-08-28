import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type MetadataDb = Database;

/** Opens the metadata database with the pragmas every connection needs. */
export function openMetadataDb(path: string): MetadataDb {
  const db = new Database(path, { create: true, strict: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

export type MigrationReport = { applied: string[]; skipped: number };

type LedgerRow = { version: number };

export const DEFAULT_MIGRATIONS_DIR = join(import.meta.dir, "..", "..", "db", "migrations");

/** Applies numbered SQL files in order, one transaction each, recorded in schema_migrations. */
export function migrate(
  db: MetadataDb,
  migrationsDir: string = DEFAULT_MIGRATIONS_DIR
): MigrationReport {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)"
  );
  const ledger = db.query<LedgerRow, []>("SELECT version FROM schema_migrations").all();
  const done = new Set(ledger.map((row) => row.version));
  const files = [...new Bun.Glob("*.sql").scanSync(migrationsDir)].sort();
  const applied: string[] = [];
  let skipped = 0;
  for (const file of files) {
    const version = Number(file.slice(0, 4));
    if (!Number.isInteger(version))
      throw new Error(`migration file name must start with four digits: ${file}`);
    if (done.has(version)) {
      skipped += 1;
      continue;
    }
    const text = readFileSync(join(migrationsDir, file), "utf8");
    const run = db.transaction(() => {
      db.exec(text);
      db.query("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?1, ?2, ?3)").run(
        version,
        file,
        new Date().toISOString()
      );
    });
    run();
    applied.push(file);
  }
  return { applied, skipped };
}
