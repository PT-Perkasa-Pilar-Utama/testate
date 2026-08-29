import { describe, expect, it } from "bun:test";

import { createTestDb } from "../../../test/db.ts";
import { loadKeyRing, seal } from "./index.ts";
import type { KeyRing } from "./index.ts";
import { aadFor, banner, disableUnreadableOwners, sweep } from "./registry.ts";

function key(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
}

const NOW = "2026-08-29T08:00:00.000Z";

async function insertAdapter(
  db: ReturnType<typeof createTestDb>,
  id: string,
  ring: KeyRing
): Promise<void> {
  db.query(
    "INSERT INTO users (id, username, display_name, role, password_hash, created_at, updated_at) VALUES ('u1', 'admin', 'admin', 'admin', 'x', ?, ?)"
  ).run(NOW, NOW);
  db.query(
    "INSERT OR IGNORE INTO projects (id, slug, name, created_by, created_at, updated_at) VALUES ('p1', 'shop', 'Shop', 'u1', ?, ?)"
  ).run(NOW, NOW);
  const sealed = await seal(
    ring,
    JSON.stringify({ password: "pw" }),
    aadFor("adapters", "config_sealed", id)
  );
  db.query(
    `INSERT INTO adapters (id, project_id, kind, engine, name, config_public, config_sealed, created_at, updated_at)
     VALUES (?, 'p1', 'database', 'postgres', ?, '{}', ?, ?, ?)`
  ).run(id, `a-${id}`, sealed, NOW, NOW);
}

describe("sealed sweep", () => {
  it("re-seals values sealed by an older listed key and reports COMPLETE", async () => {
    const oldKey = key();
    const newKey = key();
    const db = createTestDb();
    await insertAdapter(db, "a1", await loadKeyRing(oldKey));
    const ring = await loadKeyRing(`${newKey},${oldKey}`);
    const report = await sweep(ring, db);
    expect(report).toStrictEqual({ reSealed: 1, unreadable: [], skipped: 0 });
    expect(banner(report, ring)).toBe("SECRET KEY ROTATION COMPLETE");
    const again = await sweep(ring, db);
    expect(again).toStrictEqual({ reSealed: 0, unreadable: [], skipped: 1 });
    expect(banner(again, ring)).toBe("EXTRA VALUE STILL CONFIGURED");
  });

  it("lists values no configured key opens and can disable their owners", async () => {
    const db = createTestDb();
    await insertAdapter(db, "a1", await loadKeyRing(key()));
    const ring = await loadKeyRing(key());
    const report = await sweep(ring, db);
    expect(
      report.unreadable.map((item) => `${item.table}.${item.column}:${item.rowId}`)
    ).toStrictEqual(["adapters.config_sealed:a1"]);
    expect(banner(report, ring)).toBeNull();
    expect(disableUnreadableOwners(db, report, NOW)).toBe(1);
    expect(
      db.query("SELECT status, status_message FROM adapters WHERE id = 'a1'").get()
    ).toStrictEqual({
      status: "disabled",
      status_message: "credential_unreadable",
    });
  });

  it("is silent with one key and nothing to do", async () => {
    const ring = await loadKeyRing(key());
    const report = await sweep(ring, createTestDb());
    expect(report).toStrictEqual({ reSealed: 0, unreadable: [], skipped: 0 });
    expect(banner(report, ring)).toBeNull();
  });
});
