import { describe, expect, test } from "bun:test";
import type { Preflight, State, StateAdapter } from "@testate/shared";

import {
  canCheckout,
  driftedAdapters,
  driftSummary,
  strategyLine,
} from "../checkouts/preflight.presenter.ts";
import { adapterSummary, consistencyLabel, sortLabel } from "./states.format.ts";
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
    expect(strategyLine(ADAPTER)).toBe("truncate · session-disable FKs · atomic");
    expect(strategyLine({ ...ADAPTER, atomic: false })).toBe(
      "truncate · session-disable FKs · not atomic"
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

  test("sort and consistency read as words, not the API's punctuation (labels pass)", () => {
    expect(sortLabel("primary-key")).toBe("primary key order");
    expect(sortLabel("row-hash")).toBe("row hash order");
    expect(consistencyLabel("snapshot")).toBe("consistent snapshot");
    expect(consistencyLabel("best_effort")).toBe("best effort");
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
