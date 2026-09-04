import { describe, expect, it } from "bun:test";

import type { Heartbeat } from "./modules/jobs/jobs.dispatcher.ts";
import { jobsRunningFrom } from "./wiring.store.ts";

function heartbeat(running: number, queued: number): Heartbeat {
  return { alive: true, running, queued, lastTickAt: null };
}

describe("jobsRunningFrom", () => {
  it("counts a queued job as jobs running, not only a running one", () => {
    expect(jobsRunningFrom(heartbeat(0, 1))).toBe(true);
  });

  it("is idle when nothing runs and nothing is queued", () => {
    expect(jobsRunningFrom(heartbeat(0, 0))).toBe(false);
  });
});
