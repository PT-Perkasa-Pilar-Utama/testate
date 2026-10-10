import { describe, expect, it } from "bun:test";
import type { Actor } from "@testate/shared";
import * as v from "valibot";

import { PG, createAdaptersHarness, createSettled } from "../../../test/adapters.ts";
import { logsDepsOf } from "../../../test/logs.ts";
import { createLogsService } from "./logs.service.ts";

// #84 (D3, D4, D7 of docs/decisions/2026-10-10-db-server-logs.md): a database adapter's server
// log reads like any log, a page at a time; a viewer never sees a value from a statement.
async function setup() {
  const h = await createAdaptersHarness();
  const db = await createSettled(h, PG);
  const logs = createLogsService(logsDepsOf(h));
  const viewer: Actor = { ...h.qa, role: "viewer" };
  return { h, db, logs, viewer };
}

const messages = (page: { entries: { message: string }[] }) =>
  page.entries.map((entry) => entry.message.split("\n")[0]);

describe("a database adapter's statements", () => {
  it("read raw for a tester, newest first, a page at a time with no line twice", async () => {
    const { h, db, logs } = await setup();
    const first = await logs.read(h.qa, "shop", db.id, { source: "statements", limit: 2 }, null);
    const second = await logs.read(
      h.qa,
      "shop",
      db.id,
      { source: "statements", limit: 2, cursor: v.parse(v.string(), first.page.cursor) },
      null
    );
    expect([
      messages(first.page),
      messages(second.page),
      second.page.cursor,
      second.page.cut_by,
    ]).toEqual([
      [
        "INSERT INTO refunds (token) VALUES ('tok_live_abc123')",
        "UPDATE orders SET total = 42 WHERE id = 7",
      ],
      [
        "SELECT * FROM users WHERE email = 'ana@shop.test'",
        "INSERT INTO users (email) VALUES ('ana@shop.test')",
      ],
      null,
      "window",
    ]);
  });

  it("show a viewer no literal and no field value", async () => {
    const { db, logs, viewer } = await setup();
    const { page } = await logs.read(
      viewer,
      "shop",
      db.id,
      { source: "statements", limit: 10 },
      null
    );
    expect(
      page.entries.map((entry) => [entry.message.split("\n")[0], entry.fields, entry.masked])
    ).toEqual([
      ["INSERT INTO refunds (token) VALUES (?)", { pid: "?", user: "?" }, true],
      ["UPDATE orders SET total = ? WHERE id = ?", { pid: "?", user: "?" }, true],
      ["SELECT * FROM users WHERE email = ?", { pid: "?", user: "?" }, true],
      ["INSERT INTO `users` ( `email` ) VALUES (?)", { pid: "?", user: "?" }, true],
    ]);
    expect(JSON.stringify(page.entries).includes("ana@shop.test")).toBe(false);
  });

  it("filter by level, and follow shows nothing it already showed", async () => {
    const { h, db, logs } = await setup();
    const errors = await logs.read(
      h.qa,
      "shop",
      db.id,
      { source: "statements", limit: 10, level: "error" },
      null
    );
    const follow = await logs.read(
      h.qa,
      "shop",
      db.id,
      { source: "statements", limit: 10, after: errors.page.after },
      null
    );
    expect([messages(errors.page), follow.page.entries]).toEqual([
      [
        "INSERT INTO refunds (token) VALUES ('tok_live_abc123')",
        "INSERT INTO users (email) VALUES ('ana@shop.test')",
      ],
      [],
    ]);
  });

  it("list what the credential can read, and answer an unreadable source with that list", async () => {
    const { h, db, logs } = await setup();
    expect(await logs.sources("shop", db.id, null)).toEqual(["statements"]);
    await expect(
      logs.read(h.qa, "shop", db.id, { source: "server-log", limit: 10 }, null)
    ).rejects.toMatchObject({ code: "NOT_FOUND", details: { sources: ["statements"] } });
  });
});
