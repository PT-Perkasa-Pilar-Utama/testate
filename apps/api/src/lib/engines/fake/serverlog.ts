import type { ServerLogSource } from "@testate/shared";

import { pageWindow } from "../../logs/server.ts";
import type { ServerLogEntry, ServerLogPage, ServerLogRead } from "../types.ts";

/**
 * The fake engine's "Statements" (#84): two statements carrying values, a third with the same time
 * as the second so a page boundary falls on a tie, and an error. Newest last here; the page sorts.
 */
export const FAKE_STATEMENTS: ServerLogEntry[] = [
  {
    key: { time: Date.parse("2026-10-10T08:00:01.000Z"), id: "000001" },
    level: "info",
    message: "SELECT * FROM users WHERE email = 'ana@shop.test'",
    digest: null,
    fields: { pid: "101", user: "app" },
  },
  {
    key: { time: Date.parse("2026-10-10T08:00:02.000Z"), id: "000002" },
    level: "info",
    message: "UPDATE orders SET total = 42 WHERE id = 7",
    digest: null,
    fields: { pid: "102", user: "app" },
  },
  {
    // A statement the engine keeps a digest for, its error carrying a value (D7).
    key: { time: Date.parse("2026-10-10T08:00:00.000Z"), id: "000000" },
    level: "error",
    message: "INSERT INTO users (email) VALUES ('ana@shop.test')\nDuplicate entry 'ana@shop.test'",
    digest: "INSERT INTO `users` ( `email` ) VALUES (?)\nDuplicate entry ?",
    fields: { pid: "100", user: "app" },
  },
  {
    key: { time: Date.parse("2026-10-10T08:00:02.000Z"), id: "000003" },
    level: "error",
    message: "INSERT INTO refunds (token) VALUES ('tok_live_abc123')\nduplicate key",
    digest: null,
    fields: { pid: "103", user: "app" },
  },
];

export async function fakeServerLog(
  source: ServerLogSource,
  page: ServerLogPage
): Promise<ServerLogRead> {
  return source === "statements" ? pageWindow(FAKE_STATEMENTS, page) : { entries: [], end: true };
}
