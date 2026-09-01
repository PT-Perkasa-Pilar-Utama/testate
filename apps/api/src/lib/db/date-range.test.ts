import { describe, expect, it } from "bun:test";

import { createdRangeConditions } from "./date-range.ts";

describe("a created-date range on its way into WHERE", () => {
  it("emits nothing for an unset range", () => {
    expect(createdRangeConditions("created_at", undefined, undefined)).toStrictEqual([]);
  });

  it("compares the from bound at midnight of that day", () => {
    expect(createdRangeConditions("created_at", "2026-08-30", undefined)).toStrictEqual([
      { sql: "created_at >= ?", params: ["2026-08-30"] },
    ]);
  });

  it("compares the to bound against the end of that day, not its midnight", () => {
    expect(createdRangeConditions("created_at", undefined, "2026-08-30")).toStrictEqual([
      { sql: "created_at <= ?", params: ["2026-08-30T23:59:59.999Z"] },
    ]);
  });

  it("treats an empty string the same as unset, so a cleared filter drops the condition", () => {
    expect(createdRangeConditions("created_at", "", "")).toStrictEqual([]);
  });
});
