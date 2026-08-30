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

/** The password `adminSession` leaves an instance on; the lock has to refuse this one too. */
const BOOT_PASSWORD = "boot-admin-password-1";

type UserRow = { failed_attempts: number; locked_until: string | null };

function adminRow(dir: string): UserRow {
  const rows = runSqlite<UserRow[]>(dir, [
    "SELECT failed_attempts, locked_until FROM users WHERE username = 'admin'",
  ]);
  const row = rows[0];
  if (row === undefined) throw new Error("the instance holds no admin");
  return row;
}

/**
 * Its own instance, on its own port: locking an account is fifteen minutes of state, and the demo
 * users the rest of the suite signs in with cannot carry it.
 */
test("@story-7 five wrong passwords lock the account for fifteen minutes", async () => {
  test.setTimeout(180_000);
  const dir = bootDir("lockout");
  const booted = await bootApi(bootEnv(dir, newKey(), 3114));
  const wrong = { username: "admin", password: "not-the-password" };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const refused = await fetch(`${booted.base}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Testate-Request": "1" },
      body: JSON.stringify(wrong),
    });
    expect(refused.status).toBe(401);
  }

  // The fifth failure is what arms it, and the row says so.
  const locked = adminRow(dir);
  expect(locked.failed_attempts).toBe(5);
  const until = Date.parse(String(locked.locked_until));
  expect(until - Date.now()).toBeGreaterThan(14 * 60 * 1000);
  expect(until - Date.now()).toBeLessThanOrEqual(15 * 60 * 1000);

  // The right password is refused too while the lock holds, and the answer says how long.
  const rightNow = await fetch(`${booted.base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Testate-Request": "1" },
    body: JSON.stringify({ username: "admin", password: BOOT_PASSWORD }),
  });
  expect(rightNow.status).toBe(429);
  expect(rightNow.headers.get("retry-after")).not.toBeNull();

  // Wind the clock past the lock, and the same password is taken.
  runSqlite(dir, [`UPDATE users SET locked_until = '${iso(-1000)}' WHERE username = 'admin'`]);
  const after = await fetch(`${booted.base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Testate-Request": "1" },
    body: JSON.stringify({ username: "admin", password: BOOT_PASSWORD }),
  });
  expect(after.status).toBe(200);
  expect(adminRow(dir).failed_attempts).toBe(0);
  expect(await booted.stop()).toBe(0);
});
