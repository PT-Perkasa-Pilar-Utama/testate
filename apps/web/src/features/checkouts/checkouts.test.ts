import { describe, expect, test } from "bun:test";
import type { Checkout } from "@testate/shared";

import {
  blockingSessions,
  countersSummary,
  retriable,
  skippedSummary,
} from "./checkouts.presenter.ts";

const ADAPTER: Checkout["adapters"][number] = {
  adapter_id: "a1",
  name: "pg",
  engine: "postgres",
  result: "restored",
  strategy: null,
  rows: 10,
  duration_ms: 5,
  lock_wait_ms: 0,
  skipped_tables: [],
  skipped_columns: [],
  defaulted_columns: [],
  error: null,
};
const CHECKOUT: Checkout = {
  id: "c1",
  state: { id: "s1", name: "base" },
  job_id: "j1",
  stash_state_id: null,
  force: false,
  purpose: "checkout",
  status: "succeeded",
  adapters: [ADAPTER],
  actor: { kind: "user", id: "u1", label: "qa", role: "qa", agent: false },
  created_at: "2026-08-29T00:00:00.000Z",
  finished_at: "2026-08-29T00:00:01.000Z",
};

describe("checkouts feature", () => {
  test("only a finished checkout with a retriable adapter result can be retried (story 80)", () => {
    expect(retriable(CHECKOUT)).toBe(false);
    expect(retriable({ ...CHECKOUT, adapters: [{ ...ADAPTER, result: "rolled_back" }] })).toBe(
      true
    );
    expect(
      retriable({
        ...CHECKOUT,
        status: "running",
        adapters: [{ ...ADAPTER, result: "pending" }],
      })
    ).toBe(false);
  });

  test("blocking session ids come from the adapter error details (story 85)", () => {
    expect(blockingSessions(ADAPTER)).toStrictEqual([]);
    expect(
      blockingSessions({
        ...ADAPTER,
        error: {
          code: "CHECKOUT_BLOCKED",
          message: "lock",
          details: { blocking_sessions: ["42"] },
        },
      })
    ).toStrictEqual(["42"]);
    expect(
      blockingSessions({
        ...ADAPTER,
        error: { code: "CHECKOUT_BLOCKED", message: "lock", details: { blocking_sessions: "x" } },
      })
    ).toStrictEqual([]);
  });

  test("counters and skipped work are summarised for the dialogs (stories 78, 81)", () => {
    expect(
      countersSummary({
        adapters: [
          {
            adapter_id: "a1",
            counters: [
              { name: "s1", ok: true },
              { name: "s2", ok: false },
            ],
          },
          { adapter_id: "a2", counters: [{ name: "t", ok: true }] },
        ],
      })
    ).toBe("2 ok · 1 failed");
    expect(skippedSummary(ADAPTER)).toBe("");
    expect(
      skippedSummary({
        ...ADAPTER,
        skipped_tables: [{ schema: null, name: "audit" }],
        skipped_columns: [{ table: "orders", column: "note" }],
        defaulted_columns: [{ table: "orders", column: "flag" }],
      })
    ).toBe("1 tables, 1 columns skipped · 1 columns defaulted");
  });
});
