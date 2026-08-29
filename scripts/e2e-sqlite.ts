/**
 * Runs SQL against a metadata database for the end-to-end suite, which runs under Node and cannot
 * open `bun:sqlite`. Statements arrive as a JSON array on stdin; the last result prints as JSON.
 *
 *   echo '["select count(*) as n from sessions"]' | bun scripts/e2e-sqlite.ts .e2e/boot/x/metadata.db
 */
import { Database } from "bun:sqlite";

const path = process.argv[2] ?? "";
if (path === "") throw new Error("usage: bun scripts/e2e-sqlite.ts <metadata.db>");

const parsed: unknown = JSON.parse(await Bun.stdin.text());
if (!Array.isArray(parsed)) throw new Error("stdin must hold a JSON array of statements");

const db = new Database(path, { strict: true });
db.exec("PRAGMA busy_timeout = 5000");
try {
  const results = [];
  for (const statement of parsed) results.push(db.query(String(statement)).all());
  console.log(JSON.stringify(results.at(-1) ?? null));
} finally {
  db.close();
}
