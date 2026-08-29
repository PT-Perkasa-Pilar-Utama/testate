/**
 * Runs SQL against a compose engine for the end-to-end suite, which itself runs under Node and has
 * no database driver. Statements arrive as a JSON array on stdin; the last result prints as JSON.
 *
 *   echo '["select 1 as n"]' | bun scripts/e2e-sql.ts postgres://user:pw@host:port/db
 */
import { SQL } from "bun";

const url = process.argv[2] ?? "";
if (url === "") throw new Error("usage: bun scripts/e2e-sql.ts <connection url>");

const parsed: unknown = JSON.parse(await Bun.stdin.text());
if (!Array.isArray(parsed)) throw new Error("stdin must hold a JSON array of statements");
const statements = parsed.map((statement) => String(statement));

// One connection, so BEGIN and the statements after it share a session.
const sql = new SQL(url, { max: 1 });
try {
  const results = [];
  for (const statement of statements) results.push(await sql.unsafe(statement));
  console.log(JSON.stringify(results.at(-1) ?? null));
} finally {
  await sql.end();
}
