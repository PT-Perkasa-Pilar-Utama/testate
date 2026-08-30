import { expect, test } from "bun:test";

import { formatWhen } from "./format.ts";

test("an ISO timestamp becomes a date a person reads", () => {
  expect(formatWhen("2026-08-30T03:46:56.037Z")).toMatch(/30 Aug 2026/);
});

test("anything that is not a timestamp is left alone", () => {
  expect(formatWhen("never")).toBe("never");
});
