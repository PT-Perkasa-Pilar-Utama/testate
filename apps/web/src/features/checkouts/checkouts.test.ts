import { describe, expect, test } from "bun:test";
import type { Checkout, Counters } from "@testate/shared";

import { checkoutsQuery } from "./checkouts.model.ts";
import {
  adaptersSummary,
  blockedAdapters,
  blockingSessions,
  countersSummary,
  hasFailure,
  outcomeLine,
  retriable,
  retryBlockedReason,
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

  test("blocked adapters are the ones with a session to terminate (story 85)", () => {
    expect(blockedAdapters(CHECKOUT)).toStrictEqual([]);
    const blocked = {
      ...ADAPTER,
      error: { code: "CHECKOUT_BLOCKED", message: "lock", details: { blocking_sessions: ["42"] } },
    };
    expect(blockedAdapters({ ...CHECKOUT, adapters: [ADAPTER, blocked] })).toStrictEqual([blocked]);
  });

  test("Retry says why it is dead next to the button (defect fix, same shape as preflight)", () => {
    expect(retryBlockedReason(CHECKOUT)).toBe("Nothing to retry. Every database finished cleanly.");
    expect(retryBlockedReason({ ...CHECKOUT, status: "running" })).toBe(
      "Wait for this restore to finish."
    );
    expect(
      retryBlockedReason({ ...CHECKOUT, adapters: [{ ...ADAPTER, result: "rolled_back" }] })
    ).toBeUndefined();
  });

  test("the row's outcome line names the failed database first, then what was skipped", () => {
    expect(outcomeLine(CHECKOUT)).toBe("");
    const failed = { ...ADAPTER, error: { code: "X", message: "lock timeout" } };
    expect(outcomeLine({ ...CHECKOUT, adapters: [failed] })).toBe("pg: lock timeout");
    const skipped = { ...ADAPTER, skipped_tables: [{ schema: null, name: "audit" }] };
    expect(outcomeLine({ ...CHECKOUT, adapters: [skipped] })).toBe("1 tables skipped");
  });

  test("a failure count that ends in 0 still reads as a failure (regression, was string-matched)", () => {
    const tenFailed: Counters = {
      adapters: [
        {
          adapter_id: "a1",
          counters: Array.from({ length: 12 }, (_, index) => ({
            name: `s${index}`,
            ok: index >= 10,
          })),
        },
      ],
    };
    expect(countersSummary(tenFailed)).toBe("2 ok · 10 failed");
    expect(hasFailure(tenFailed)).toBe(true);
    expect(
      hasFailure({ adapters: [{ adapter_id: "a1", counters: [{ name: "s", ok: true }] }] })
    ).toBe(false);
  });
});

describe("checkoutsQuery", () => {
  test("adds status and purpose only once a filter has picked one", () => {
    expect(checkoutsQuery({}, undefined, { status: "", purpose: "" })).toStrictEqual({
      cursor: undefined,
      sort: undefined,
      order: undefined,
      q: undefined,
      created_from: undefined,
      created_to: undefined,
      status: undefined,
      purpose: undefined,
    });
    expect(checkoutsQuery({}, "c1", { status: "failed", purpose: "return_to_init" })).toStrictEqual(
      {
        cursor: "c1",
        sort: undefined,
        order: undefined,
        q: undefined,
        created_from: undefined,
        created_to: undefined,
        status: "failed",
        purpose: "return_to_init",
      }
    );
  });
});

describe("the checkouts list's databases line", () => {
  test("counts each outcome, in the order they appear", () => {
    const one = (name: string, result: Checkout["adapters"][number]["result"]) => ({
      ...ADAPTER,
      adapter_id: name,
      name,
      result,
    });
    expect(
      adaptersSummary({ ...CHECKOUT, adapters: [one("a", "restored"), one("b", "restored")] })
    ).toBe("2 restored");
    expect(
      adaptersSummary({ ...CHECKOUT, adapters: [one("a", "restored"), one("b", "skipped")] })
    ).toBe("1 restored, 1 skipped");
  });
});
