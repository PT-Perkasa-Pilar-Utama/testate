import { describe, expect, test } from "bun:test";

import { runLink, runWindow } from "./logs.run.ts";

// #69, Q8 (docs/decisions/2026-10-10-logs-tier.md): "Logs during this run" opens the viewer from a
// minute before the run to five minutes after it, or up to now while it runs.
const ADAPTER = {
  id: "a-logs",
  project_slug: "shop",
  config: {
    transport: "sftp",
    host: "logs.sit.internal",
    user: "deploy",
    sources: [{ name: "api", glob: "logs/api-*.log", format: "pm2" }],
  },
};

describe("a run's log window", () => {
  test("starts a minute early and ends five minutes late", () => {
    expect(runWindow("2026-10-10T08:00:00.000Z", "2026-10-10T08:02:00.000Z")).toEqual({
      from: "2026-10-10T07:59:00.000Z",
      to: "2026-10-10T08:07:00.000Z",
    });
  });

  test("stays open while the run is going", () => {
    expect(runWindow("2026-10-10T08:00:00.000Z", null)).toEqual({
      from: "2026-10-10T07:59:00.000Z",
      to: null,
    });
  });

  test("keeps to the API's 7-day window for a run that took longer", () => {
    expect(runWindow("2026-10-01T00:00:00.000Z", "2026-10-09T23:55:00.000Z").from).toBe(
      "2026-10-03T00:00:00.000Z"
    );
  });

  test("links the adapter page on its first source and the window", () => {
    const link = runLink(ADAPTER, { from: "2026-10-10T07:59:00.000Z", to: null });
    expect(link).toBe(
      "/projects/shop/adapters/a-logs?source=api&from=2026-10-10T07%3A59%3A00.000Z"
    );
  });
});
