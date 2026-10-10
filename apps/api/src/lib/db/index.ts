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

/**
 * A migration that rebuilds a table other tables point at carries this line in its leading comments. SQLite applies
 * foreign keys per statement, so dropping the old table would delete every row that references
 * it; this runs the migration with them off, as SQLite's own rebuild procedure does, and refuses
 * the migration if any reference is broken at the end.
 */
export const FOREIGN_KEYS_OFF = "-- testate:foreign-keys-off";

/**
 * Whether a migration asks for foreign keys off: the marker counts anywhere in the comment block
 * the file opens with. Found anywhere else it is refused, because a disarmed rebuild would run
 * with keys on, cascade its DROP TABLE through every child row, and still succeed.
 */
export function wantsForeignKeysOff(file: string, text: string): boolean {
  const lines = text.split("\n").map((line) => line.trim());
  const end = lines.findIndex((line) => line !== "" && !line.startsWith("--"));
  const leading = end === -1 ? lines : lines.slice(0, end);
  if (leading.includes(FOREIGN_KEYS_OFF)) return true;
  if (text.includes(FOREIGN_KEYS_OFF))
    throw new Error(`${file}: the foreign-keys-off marker must be in the leading comments`);
  return false;
}

function applyOne(db: MetadataDb, version: number, file: string, text: string): void {
  const keysOff = wantsForeignKeysOff(file, text);
  // The pragma is a no-op inside a transaction, so it is set before the transaction opens.
  if (keysOff) db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.transaction(() => {
      db.exec(text);
      const broken = keysOff ? db.query("PRAGMA foreign_key_check").all().length : 0;
      if (broken > 0) throw new Error(`${file} left ${broken} broken foreign key reference(s)`);
      db.query("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?1, ?2, ?3)").run(
        version,
        file,
        new Date().toISOString()
      );
    })();
  } finally {
    if (keysOff) db.exec("PRAGMA foreign_keys = ON");
  }
}

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
    applyOne(db, version, file, readFileSync(join(migrationsDir, file), "utf8"));
    applied.push(file);
  }
  return { applied, skipped };
}
