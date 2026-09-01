import { describe, expect, test } from "bun:test";

import { queryOf } from "./audit.model.ts";

const EMPTY = { action: "", actor: "", outcome: "", from: "", to: "" };

describe("queryOf", () => {
  test("sends nothing for a field the person left blank", () => {
    expect(queryOf(EMPTY, undefined)).toStrictEqual({
      action: undefined,
      actor: undefined,
      outcome: undefined,
      from: undefined,
      to: undefined,
      cursor: undefined,
    });
  });

  test("widens `to` to the end of that day, since the repository compares it with a plain <=", () => {
    expect(queryOf({ ...EMPTY, from: "2026-08-28", to: "2026-08-30" }, "c1")).toStrictEqual({
      action: undefined,
      actor: undefined,
      outcome: undefined,
      from: "2026-08-28",
      to: "2026-08-30T23:59:59.999Z",
      cursor: "c1",
    });
  });
});
