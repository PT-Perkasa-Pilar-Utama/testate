import { expect, test } from "@playwright/test";

import { bootApi, bootDir, bootEnv, newKey } from "./lib/boot.ts";
import { adminSession, call } from "./lib/instance.ts";
import { runSqlite } from "./lib/sql.ts";

const HOUR = 60 * 60 * 1000;

type SessionRow = { id: string; created_at: string; last_seen_at: string; expires_at: string };

function sessionRow(dir: string): SessionRow {
  const rows = runSqlite<SessionRow[]>(dir, [
    "SELECT id, created_at, last_seen_at, expires_at FROM sessions ORDER BY created_at DESC LIMIT 1",
  ]);
  const row = rows[0];
  if (row === undefined) throw new Error("the instance holds no session");
  return row;
}

function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

test("@story-8 a session ends after twelve idle hours and after seven days either way", async () => {
  test.setTimeout(180_000);
  const dir = bootDir("sessions");
  const booted = await bootApi(bootEnv(dir, newKey(), 3112));
  const session = await adminSession(booted.base);

  // The idle window is the deadline a fresh session carries.
  const fresh = sessionRow(dir);
  const window = Date.parse(fresh.expires_at) - Date.parse(fresh.created_at);
  expect(window).toBe(12 * HOUR);

  // Seven days in, the touch on the next request may not push the deadline past the seventh day.
  runSqlite(dir, [
    `UPDATE sessions SET created_at = '${iso(-7 * 24 * HOUR + HOUR)}',
     last_seen_at = '${iso(-2 * 60 * 1000)}' WHERE id = '${fresh.id}'`,
  ]);
  expect((await call(session, "GET", "auth/me")).status).toBe(200);
  const capped = sessionRow(dir);
  expect(Date.parse(capped.expires_at) - Date.now()).toBeLessThan(2 * HOUR);

  // Idle for longer than the window: the session is gone, and the cookie with it.
  runSqlite(dir, [`UPDATE sessions SET expires_at = '${iso(-HOUR)}' WHERE id = '${fresh.id}'`]);
  expect((await call(session, "GET", "auth/me")).status).toBe(401);
  expect(runSqlite<SessionRow[]>(dir, ["SELECT id FROM sessions"]).length).toBe(0);
  expect(await booted.stop()).toBe(0);
});
