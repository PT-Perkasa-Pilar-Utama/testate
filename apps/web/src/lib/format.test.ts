import { describe, expect, test } from "bun:test";

import { formatWhen, toDateInput } from "./format.ts";

describe("when something happened", () => {
  test("day, month, year, and the clock down to the second", () => {
    expect(formatWhen("2019-03-04T09:07:32.000Z")).toMatch(/^04\/03\/2019 \d{2}:07:32$/);
  });

  test("the year is there inside the current one too, or a list across new year cannot be read", () => {
    const thisYear = `${new Date().getFullYear()}-03-04T09:07:00.000Z`;
    expect(formatWhen(thisYear)).toMatch(new RegExp(`^04/03/${new Date().getFullYear()} `));
  });

  test("a 24-hour clock whoever is reading, so it matches the log lines beside it", () => {
    expect(formatWhen("2019-03-04T21:07:00.000Z")).not.toContain("pm");
    expect(formatWhen("2019-03-04T21:07:00.000Z")).not.toContain("PM");
  });

  test("something that is not a date comes back as it went in", () => {
    expect(formatWhen("never")).toBe("never");
  });

  test("a date input wants the day alone", () => {
    expect(toDateInput("2026-08-30T03:46:56.037Z")).toBe("2026-08-30");
  });
});
