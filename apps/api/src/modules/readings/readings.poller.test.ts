import { describe, expect, it } from "bun:test";

import { WideEvent } from "../../lib/logger/event.ts";
import type { WideEventRecord } from "../../lib/logger/index.ts";
import { createPoller } from "./readings.poller.ts";
import type { PollerDeps } from "./readings.poller.ts";
import type { ReadingStats } from "./readings.service.ts";

const STATS: ReadingStats = { adapters: 2, values: 10, unavailable: 1, ms: 5 };

type Harness = {
  deps: PollerDeps;
  events: WideEventRecord[];
  released: string[][];
  closed: number[];
};

/** `outcome` per project: its stats, null for nothing to read, or an error. */
function harness(outcome: Map<string, ReadingStats | null | Error>): Harness {
  const events: WideEventRecord[] = [];
  const released: string[][] = [];
  const closed: number[] = [];
  const deps: PollerDeps = {
    readings: {
      targets: () => ({ projectIds: [...outcome.keys()], adapterIds: new Set(["a1", "a2"]) }),
      poll: async (id) => {
        const result = outcome.get(id);
        if (result instanceof Error) throw result;
        return result ?? null;
      },
    },
    sources: {
      release: async (live) => {
        released.push([...live]);
      },
      closeAll: async () => {
        closed.push(1);
      },
    },
    intervalSeconds: async () => 3600,
    logger: { create: (kind) => new WideEvent(kind, (record) => events.push(record)) },
    now: () => new Date("2026-10-11T09:00:00.000Z"),
  };
  return { deps, events, released, closed };
}

describe("the monitor's poller (#101)", () => {
  it("polls every project, counts what it read, and writes one event per tick", async () => {
    const h = harness(
      new Map<string, ReadingStats | null | Error>([
        ["p1", STATS],
        ["p2", null],
        ["p3", new Error("database is locked")],
      ])
    );
    const report = await createPoller(h.deps).tick();
    expect(report).toEqual({
      projects: 3,
      polled: 1,
      values: 10,
      unavailable: 1,
      failed: 1,
      ms: 0,
    });
    expect(h.released).toEqual([["a1", "a2"]]);
    expect(h.events).toHaveLength(1);
    expect(h.events[0]?.sections.op).toMatchObject({
      name: "monitor",
      polled: 1,
      failures: [{ project_id: "p3", reason: "database is locked" }],
    });
  });

  it("writes no event when no project had anything to read", async () => {
    const h = harness(new Map([["p1", null]]));
    await createPoller(h.deps).tick();
    expect(h.events).toEqual([]);
  });

  it("closes every kept login when it stops", async () => {
    const h = harness(new Map());
    const poller = createPoller(h.deps);
    poller.start();
    await poller.stop();
    expect(h.closed).toEqual([1]);
  });
});
