import { describe, expect, test } from "bun:test";

import { lastChangeLine } from "./last-change.presenter.ts";
import type { Change } from "./last-change.presenter.ts";

const NOW = new Date("2026-10-11T12:00:00.000Z");
const TINA: Change = {
  action: "checkout.created",
  actor: { kind: "user", label: "tina.qa" },
  target_label: "before-refund",
  adapter_name: null,
  at: "2026-10-11T11:56:00.000Z",
};

describe("the last change by someone else (#60)", () => {
  test("names who, what and how long ago", () => {
    expect(lastChangeLine(TINA, NOW)).toBe("tina.qa checked out before-refund 4 minutes ago.");
  });

  test("names the database for a write that has one", () => {
    const writing: Change = { ...TINA, action: "write_session.started", adapter_name: "orders-db" };
    expect(lastChangeLine(writing, NOW)).toBe(
      "tina.qa started writing to orders-db 4 minutes ago."
    );
  });

  test("names a token by its label", () => {
    const token: Change = {
      ...TINA,
      action: "file.deleted",
      actor: { kind: "token", label: "token:ci-shop" },
      target_label: "fixtures/orders.csv",
      adapter_name: "uploads",
    };
    expect(lastChangeLine(token, NOW)).toBe(
      "token:ci-shop deleted fixtures/orders.csv from uploads 4 minutes ago."
    );
  });
});
