import { describe, expect, it } from "bun:test";
import { copyFileSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_MIGRATIONS_DIR, FOREIGN_KEYS_OFF, migrate, openMetadataDb } from "./index.ts";
import type { MetadataDb } from "./index.ts";

// 0011 rebuilds `adapters`, which five tables reference (docs/decisions/2026-10-10-logs-tier.md).
// An install upgrading through it must keep every adapter and every row that points at one.
const NOW = "2026-10-10T00:00:00.000Z";
const CHILDREN = [
  "column_policies",
  "known_host_keys",
  "normalizers",
  "saved_queries",
  "write_sessions",
] as const;

/** A database migrated through 0010 only: what an install has before this release. */
function before0011(): MetadataDb {
  const dir = mkdtempSync(join(tmpdir(), "testate-0010-"));
  for (const file of readdirSync(DEFAULT_MIGRATIONS_DIR).filter((f) => f < "0011")) {
    copyFileSync(join(DEFAULT_MIGRATIONS_DIR, file), join(dir, file));
  }
  const db = openMetadataDb(join(mkdtempSync(join(tmpdir(), "testate-db-")), "metadata.db"));
  migrate(db, dir);
  return db;
}

/** One user, one project, one adapter, and one row in every table that references adapters. */
function seed(db: MetadataDb): void {
  db.exec(`
    INSERT INTO users (id, username, display_name, role, password_hash, created_at, updated_at)
      VALUES ('u1', 'tina', 'Tina', 'qa', 'x', '${NOW}', '${NOW}');
    INSERT INTO projects (id, slug, name, created_by, created_at, updated_at)
      VALUES ('p1', 'shop', 'Shop', 'u1', '${NOW}', '${NOW}');
    INSERT INTO adapters (id, project_id, kind, engine, name, mode, config_public, config_sealed,
        status_message, created_at, updated_at, created_by)
      VALUES ('a1', 'p1', 'storage', 'sftp', 'logs-host', 'read_only', '{"host":"h"}', 'sealed',
        'kept', '${NOW}', '${NOW}', 'u1');
    INSERT INTO column_policies (id, adapter_id, table_name, column_name, mask, created_by,
        created_at, updated_at)
      VALUES ('c1', 'a1', 't', 'c', 'redact', 'u1', '${NOW}', '${NOW}');
    INSERT INTO known_host_keys (id, adapter_id, key_type, fingerprint, accepted_by, accepted_at)
      VALUES ('k1', 'a1', 'ssh-ed25519', 'SHA256:x', 'u1', '${NOW}');
    INSERT INTO normalizers (id, adapter_id, name, target, columns, created_by, created_at,
        updated_at)
      VALUES ('n1', 'a1', 'n', 't', '[]', 'u1', '${NOW}', '${NOW}');
    INSERT INTO saved_queries (id, adapter_id, name, body, created_by, created_at, updated_at)
      VALUES ('q1', 'a1', 'q', '{}', 'u1', '${NOW}', '${NOW}');
    INSERT INTO write_sessions (id, adapter_id, user_id, started_at)
      VALUES ('w1', 'a1', 'u1', '${NOW}');
  `);
}

const count = (db: MetadataDb, table: string): number =>
  db.query<{ n: number }, []>(`SELECT count(*) AS n FROM ${table}`).get()?.n ?? -1;
const columns = (db: MetadataDb): string[] =>
  db
    .query<{ name: string }, []>("PRAGMA table_info(adapters)")
    .all()
    .map((column) => column.name);
const indexes = (db: MetadataDb): string[] =>
  db
    .query<{ name: string }, []>("PRAGMA index_list(adapters)")
    .all()
    .map((index) => index.name)
    .sort();

describe("migration 0011 rebuilds adapters", () => {
  it("keeps every adapter, every referencing row, the columns and the indexes", () => {
    const db = before0011();
    seed(db);
    const adapter = db.query("SELECT * FROM adapters WHERE id = 'a1'").get();
    const layout = { columns: columns(db), indexes: indexes(db) };
    migrate(db);
    expect(db.query("SELECT * FROM adapters WHERE id = 'a1'").get()).toEqual(adapter);
    expect(CHILDREN.map((table) => count(db, table))).toEqual([1, 1, 1, 1, 1]);
    expect({ columns: columns(db), indexes: indexes(db) }).toEqual(layout);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("admits the Logs tier, and the references still bind: deleting the adapter cascades", () => {
    const db = before0011();
    seed(db);
    migrate(db);
    db.exec(`INSERT INTO adapters (id, project_id, kind, engine, name, config_public,
      config_sealed, created_at, updated_at)
      VALUES ('a2', 'p1', 'logs', 'logfile', 'pm2', '{}', 's', '${NOW}', '${NOW}')`);
    expect(db.query<{ foreign_keys: number }, []>("PRAGMA foreign_keys").get()).toEqual({
      foreign_keys: 1,
    });
    db.exec("DELETE FROM adapters WHERE id = 'a1'");
    expect(CHILDREN.map((table) => count(db, table))).toEqual([0, 0, 0, 0, 0]);
    expect(() =>
      db.exec(`INSERT INTO adapters (id, project_id, kind, engine, name, config_public,
        config_sealed, created_at, updated_at)
        VALUES ('a3', 'p1', 'rest', 'http', 'old', '{}', 's', '${NOW}', '${NOW}')`)
    ).toThrow("CHECK constraint failed");
  });
});

describe("a migration that runs with foreign keys off", () => {
  it("is refused and rolled back when it leaves a broken reference, and keys come back on", () => {
    const db = before0011();
    seed(db);
    const dir = mkdtempSync(join(tmpdir(), "testate-broken-"));
    writeFileSync(
      join(dir, "0099_orphan.sql"),
      `${FOREIGN_KEYS_OFF}\nINSERT INTO saved_queries (id, adapter_id, name, body, created_by,
        created_at, updated_at) VALUES ('q9', 'missing', 'q', '{}', 'u1', '${NOW}', '${NOW}');`
    );
    expect(() => migrate(db, dir)).toThrow(
      "0099_orphan.sql left 1 broken foreign key reference(s)"
    );
    expect(count(db, "saved_queries")).toBe(1);
    expect(db.query("SELECT 1 FROM schema_migrations WHERE version = 99").get()).toBeNull();
    expect(db.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  });
});
