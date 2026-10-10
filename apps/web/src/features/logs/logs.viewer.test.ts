import { describe, expect, test } from "bun:test";
import type { LogSource } from "@testate/shared";

import { fromLocalInput, toLocalInput } from "@/lib/format.ts";
import { menuOf } from "../adapter/adapter.menu.ts";
import { endNote, readLogQuery, requestOf } from "./logs.viewer.ts";

// #69, Q6–Q8 (docs/decisions/2026-10-10-logs-tier.md): the viewer opens on the source and window a
// link names, says why a page stopped, and a log adapter's page leads back to the Logs menu.
const SOURCES: LogSource[] = [
  { name: "api", glob: "logs/api-*.log", format: "pm2", patterns: [] },
  { name: "worker", glob: "logs/worker-*.log", format: "json-lines", patterns: [] },
];

describe("opening the viewer", () => {
  test("takes the source and window from a 'Logs during this run' link", () => {
    const from = "2026-10-10T07:59:00.000Z";
    const to = "2026-10-10T08:05:00.000Z";
    expect(readLogQuery(`?source=worker&from=${from}&to=${to}`, SOURCES)).toEqual({
      source: "worker",
      from,
      to,
      level: "",
      text: "",
    });
  });

  test("falls back to the first source when the link names one the adapter lacks", () => {
    expect(readLogQuery("?source=gone", SOURCES).source).toBe("api");
  });

  test("sends the search trimmed", () => {
    const filters = { source: "api", from: "", to: "", level: "warn", text: "  refund " };
    expect(requestOf(filters).text).toBe("refund");
  });
});

describe("the end of a page", () => {
  test("names the ceiling that cut it, or the start of the log once nothing is left", () => {
    expect([
      endNote("bytes", true),
      endNote("window", false),
      endNote("lines", true),
      endNote(null, true),
      endNote(null, false),
    ]).toEqual([
      "Stopped at the 10 MB read ceiling for one request.",
      "Older entries fall outside the window.",
      "",
      "",
      "The start of the log.",
    ]);
  });
});

describe("the window inputs", () => {
  test("show an instant in this browser's zone and read it back unchanged", () => {
    const at = "2026-10-10T08:00:05.000Z";
    expect(fromLocalInput(toLocalInput(at))).toBe(at);
    expect([fromLocalInput(""), toLocalInput("not a time")]).toEqual(["", ""]);
  });
});

describe("a log adapter's page", () => {
  test("leads back to the Logs menu, on its project", () => {
    expect(menuOf("logs", "shop")).toEqual({
      to: "/logs?project=shop",
      label: "Back to Logs",
      eyebrow: "Logs",
    });
  });
});
