import { describe, expect, test } from "bun:test";
import type { Preflight } from "@testate/shared";

import { canCheckout, driftSummary, strategyLine } from "../checkouts/preflight.presenter.ts";
import { parseTags, toCreateBody, toUpdateBody } from "./states.presenter.ts";

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
    expect(strategyLine(ADAPTER)).toBe("truncate · session-disable FKs · atomic");
    expect(strategyLine({ ...ADAPTER, atomic: false })).toBe(
      "truncate · session-disable FKs · not atomic"
    );
  });
});
