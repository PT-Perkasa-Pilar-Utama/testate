import { describe, expect, test } from "bun:test";

import { queryOf } from "./audit.model.ts";

const EMPTY = { q: "", action: "", actor: "", outcome: "", from: "", to: "" };

describe("queryOf", () => {
  test("sends nothing for a field the person left blank", () => {
    expect(queryOf(EMPTY, undefined)).toStrictEqual({
      q: undefined,
      action: undefined,
      actor: undefined,
      outcome: undefined,
      from: undefined,
      to: undefined,
      cursor: undefined,
    });
  });

  test("sends the day as typed; the API widens the upper bound to the end of it", () => {
    // The screen used to append the time itself, because the repository compared `to` raw. It
    // shares `createdRangeConditions` with every other list now, and appending here as well would
    // build a bound no row can be under.
    expect(queryOf({ ...EMPTY, from: "2026-08-28", to: "2026-08-30" }, "c1")).toStrictEqual({
      q: undefined,
      action: undefined,
      actor: undefined,
      outcome: undefined,
      from: "2026-08-28",
      to: "2026-08-30",
      cursor: "c1",
    });
  });

  test("the search box goes out as one term for the API to look for in three places", () => {
    expect(queryOf({ ...EMPTY, q: "adm" }, undefined).q).toBe("adm");
  });
});
