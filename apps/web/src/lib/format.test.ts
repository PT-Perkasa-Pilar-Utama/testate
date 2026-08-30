import { expect, test } from "bun:test";

import { formatWhen } from "./format.ts";

test("a timestamp in another year keeps the year", () => {
  expect(formatWhen("2019-03-04T09:07:00.000Z")).toMatch(/^4 Mar 2019, \d{2}:\d{2}$/);
});

test("a timestamp in this year drops it, so the column stays on one line", () => {
  const thisYear = `${new Date().getFullYear()}-03-04T09:07:00.000Z`;
  expect(formatWhen(thisYear)).toMatch(/^04 Mar, \d{2}:\d{2}$/);
});

test("anything that is not a timestamp is left alone", () => {
  expect(formatWhen("never")).toBe("never");
});
