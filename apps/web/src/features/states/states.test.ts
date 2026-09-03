import { describe, expect, test } from "bun:test";

import { eventsLabel } from "./states.format.ts";

import type { DetailTable, Preflight, State, StateAdapter } from "@testate/shared";

import {
  canCheckout,
  driftedAdapters,
  driftSummary,
  strategyLine,
} from "../checkouts/preflight.presenter.ts";
import { sortTables } from "./state.presenter.ts";
import { adapterSummary, sortLabel } from "./states.format.ts";
import {
  checkoutBlockedReason,
  parseTags,
  toCreateBody,
  toUpdateBody,
} from "./states.presenter.ts";

const NO_DRIFT = {
  changed: false,
  tables: { added: [], removed: [] },
  columns: { added: [], removed: [], type_changed: [], nullability_changed: [] },
};
const DRIFT = {
  ...NO_DRIFT,
  changed: true,
  tables: { added: ["audit"], removed: [] },
  columns: { ...NO_DRIFT.columns, removed: [{ table: "orders", column: "note" }] },
};
const ADAPTER: Preflight["adapters"][number] = {
  adapter_id: "a1",
  name: "pg",
  engine: "postgres",
  included: true,
  removed: false,
  drift: DRIFT,
  strategy: {
    emptyMode: "truncate",
    foreignKeyHandling: "session-disable",
    transactional: true,
    triggerDisable: true,
    locking: "table",
  },
  atomic: true,
  locking_notice: "tables lock for the restore",
};
const PREFLIGHT: Preflight = {
  state: { id: "s1", name: "base" },
  stash_will_be_taken: true,
  adapters: [ADAPTER],
};

describe("states feature", () => {
  test("tags split on commas, trim, and dedupe", () => {
    expect(parseTags(" a, b,,a ")).toStrictEqual(["a", "b"]);
    expect(parseTags("")).toStrictEqual([]);
  });

  test("the create body names a subset only when it is a real subset (story 62)", () => {
    const draft = { name: " base ", notes: "", tags: "x", adapter_ids: ["a1"] };
    expect(toCreateBody(draft, ["a1", "a2"])).toStrictEqual({
      name: "base",
      tags: ["x"],
      adapter_ids: ["a1"],
    });
    expect(toCreateBody({ ...draft, adapter_ids: [] }, ["a1", "a2"])).toStrictEqual({
      name: "base",
      tags: ["x"],
    });
    expect(toCreateBody({ ...draft, notes: " n " }, ["a1"])).toStrictEqual({
      name: "base",
      tags: ["x"],
      notes: "n",
    });
  });

  test("the update body clears empty notes with null", () => {
    expect(toUpdateBody({ name: "b", notes: " ", tags: "", adapter_ids: [] })).toStrictEqual({
      name: "b",
      notes: null,
      tags: [],
    });
  });

  test("drift is summarised and blocks a checkout until force is on (stories 77, 78)", () => {
    expect(driftSummary(DRIFT)).toBe("1 tables added · 1 columns removed");
    expect(driftSummary(NO_DRIFT)).toBe("");
    expect(driftSummary(null)).toBe("");
    expect(canCheckout(PREFLIGHT, false)).toBe(false);
    expect(canCheckout(PREFLIGHT, true)).toBe(true);
    expect(canCheckout({ ...PREFLIGHT, adapters: [{ ...ADAPTER, included: false }] }, false)).toBe(
      true
    );
    expect(canCheckout({ ...PREFLIGHT, adapters: [{ ...ADAPTER, drift: NO_DRIFT }] }, false)).toBe(
      true
    );
  });

  test("the strategy line names empty mode, FK handling, and atomicity (stories 82, 84)", () => {
    expect(strategyLine(ADAPTER)).toBe("truncate · FKs disabled for the session · atomic");
    expect(strategyLine({ ...ADAPTER, atomic: false })).toBe(
      "truncate · FKs disabled for the session · not atomic"
    );
  });

  test("drifted adapters exclude what is not included or already removed (story 77)", () => {
    expect(driftedAdapters(PREFLIGHT)).toStrictEqual([ADAPTER]);
    expect(
      driftedAdapters({ ...PREFLIGHT, adapters: [{ ...ADAPTER, included: false }] })
    ).toStrictEqual([]);
    expect(
      driftedAdapters({ ...PREFLIGHT, adapters: [{ ...ADAPTER, removed: true }] })
    ).toStrictEqual([]);
  });

  test("Check out says why it is dead next to the button, not just in a banner (defect fix)", () => {
    const STATE: State = {
      id: "s1",
      name: "base",
      kind: "manual",
      status: "ready",
      protected: false,
      notes: null,
      tags: [],
      parent_state_id: null,
      stash_reason: null,
      adapters: [],
      size_bytes: 0,
      actor: { kind: "user", id: "u1", label: "qa", role: "qa", agent: false },
      job_id: null,
      created_at: "2026-08-29T00:00:00.000Z",
      updated_at: "2026-08-29T00:00:00.000Z",
    };
    expect(checkoutBlockedReason(STATE)).toBeUndefined();
    expect(checkoutBlockedReason({ ...STATE, status: "creating" })).toBe("Still being taken.");
    expect(checkoutBlockedReason({ ...STATE, status: "failed" })).toBe(
      "This state failed and can't be restored."
    );
  });

  test("sort reads as words, not the API's punctuation (labels pass)", () => {
    expect(sortLabel("primary-key")).toBe("primary key order");
    expect(sortLabel("row-hash")).toBe("row hash order");
  });

  test("the timeline names the databases a state covers and folds the rest into a count", () => {
    const one: StateAdapter = {
      adapter_id: "a1",
      adapter_name: "shop-postgres",
      engine: "postgres",
      engine_version: "17",
      fingerprint: "f1",
      consistency: "snapshot",
      removed: false,
      row_count: 0,
      byte_count: 0,
      warnings: [],
    };
    const named = (...names: string[]): StateAdapter[] =>
      names.map((adapter_name) => ({ ...one, adapter_name }));
    expect(adapterSummary([])).toBe("no databases");
    expect(adapterSummary(named("shop-postgres"))).toBe("shop-postgres");
    expect(adapterSummary(named("shop-postgres", "shop-mysql"))).toBe("shop-postgres, shop-mysql");
    expect(adapterSummary(named("a", "b", "c", "d"))).toBe("a, b +2");
  });
});

describe("what a state produced", () => {
  test("says it once, in words, and says nothing when it produced nothing", () => {
    expect(eventsLabel({ checkout_count: 0, diff_count: 0 })).toBe("");
    expect(eventsLabel({ checkout_count: 1, diff_count: 0 })).toBe("restored once");
    expect(eventsLabel({ checkout_count: 3, diff_count: 0 })).toBe("restored 3 times");
    expect(eventsLabel({ checkout_count: 0, diff_count: 1 })).toBe("in 1 diff");
    expect(eventsLabel({ checkout_count: 2, diff_count: 4 })).toBe("restored 2 times, in 4 diffs");
  });
});

describe("the state page's table order", () => {
  const table = (name: string, change: DetailTable["change"], rows = 1): DetailTable => ({
    schema: null,
    name,
    rows,
    bytes: 1,
    blob_hash: name,
    sort: "primary-key",
    warnings: [],
    change,
  });
  test("changes first: changed, then added, then same, each by name", () => {
    const tables = [
      table("z", "same"),
      table("m", "added"),
      table("b", "changed"),
      table("a", "same"),
    ];
    expect(sortTables(tables, "changes").map((t) => t.name)).toEqual(["b", "m", "a", "z"]);
    expect(sortTables(tables, "name").map((t) => t.name)).toEqual(["a", "b", "m", "z"]);
    expect(
      sortTables([table("x", null, 2), table("y", null, 9)], "rows").map((t) => t.name)
    ).toEqual(["y", "x"]);
  });
});
