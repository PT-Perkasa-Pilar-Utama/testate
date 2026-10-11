import { describe, expect, it } from "bun:test";
import { readingSeriesSchema } from "@testate/shared";

import { PG, PROJECT_ID, createAdaptersHarness, createSettled } from "../../../test/adapters.ts";
import type { AdaptersHarness } from "../../../test/adapters.ts";
import { expectContract } from "../../../test/contract.ts";
import { SFTP } from "../../../test/files.ts";
import type { FilesResolver } from "../adapters/adapters.files.ts";
import type { MemoryFile } from "../../lib/files/memory.ts";
import { createReadingsRepository } from "./readings.repository.ts";
import { createReadingsService } from "./readings.service.ts";
import type { ReadingsService } from "./readings.service.ts";
import { readingSources } from "./readings.sources.ts";
import type { ReadingSources } from "./readings.sources.ts";

const bytes = (text: string): MemoryFile => ({
  bytes: new TextEncoder().encode(text),
  modified_at: "2026-10-11T00:00:00.000Z",
});

type Counted = { opened: number; closed: number };

/** The resolver, counting the logins it opens and the ones closed. */
function counting(files: FilesResolver, count: Counted): FilesResolver {
  return {
    resolve: async (...args) => {
      const resolved = await files.resolve(...args);
      count.opened += 1;
      const close = resolved.source.close;
      resolved.source.close = async () => {
        count.closed += 1;
        await close();
      };
      return resolved;
    },
  };
}

type Monitor = {
  h: AdaptersHarness;
  readings: ReadingsService;
  sources: ReadingSources;
  count: Counted;
  load(value: number): void;
};

/** A Postgres adapter and an SFTP login whose load average the test sets. */
async function monitor(): Promise<Monitor> {
  const h = await createAdaptersHarness();
  await createSettled(h, PG);
  await h.adapters.create(h.qa, "shop", SFTP, { ip: null, user_agent: null, request_id: null });
  const tree = new Map<string, MemoryFile>();
  h.trees.set("sftp.sit.internal", tree);
  const count = { opened: 0, closed: 0 };
  const files = counting(h.files, count);
  const sources = readingSources({
    engines: h.engines,
    ring: h.ring,
    files,
    pause: async () => {},
  });
  const readings = createReadingsService({
    repo: createReadingsRepository(h.db),
    projects: h.projectsRepo,
    adapters: h.repo,
    readServer: sources.readServer,
    readHost: sources.readHost,
    now: h.now,
  });
  const load = (value: number): void => {
    tree.set("proc/loadavg", bytes(`${value} 0.40 0.30 1/200 999\n`));
  };
  load(1);
  // The poller never trusts a first-seen host key; a person's reading trusts it, as browsing does.
  await readings.take(h.qa, "shop");
  Object.assign(count, { opened: 0, closed: 0 });
  return { h, readings, sources, count, load };
}

describe("the monitor's polled readings (#101)", () => {
  it("stores a polled reading as Testate, never as a person", async () => {
    const { readings } = await monitor();
    await readings.poll(PROJECT_ID);
    const [row] = (await readings.list("shop", 10)).rows;
    expect(row?.source).toBe("poll");
    expect(row?.actor).toEqual({ kind: "system", label: "Testate" });
  });

  it("reads no host whose key no person has trusted yet", async () => {
    const h = await createAdaptersHarness();
    await h.adapters.create(h.qa, "shop", SFTP, { ip: null, user_agent: null, request_id: null });
    const sources = readingSources({ engines: h.engines, ring: h.ring, files: h.files });
    const readings = createReadingsService({
      repo: createReadingsRepository(h.db),
      projects: h.projectsRepo,
      adapters: h.repo,
      readServer: sources.readServer,
      readHost: sources.readHost,
      now: h.now,
    });
    await readings.poll(PROJECT_ID);
    const [row] = (await readings.list("shop", 1)).rows;
    expect(row?.adapters[0]?.values).toEqual([]);
    expect(row?.adapters[0]?.unavailable[0]?.reason).toContain("not trusted yet");
  });

  it("polls nothing for a project it does not know", async () => {
    const { readings } = await monitor();
    expect(await readings.poll("01991f00-0000-7000-8000-0000000000ff")).toBeNull();
  });

  it("keeps one SFTP login across polls, and opens one per manual reading", async () => {
    const { h, readings, count } = await monitor();
    await readings.poll(PROJECT_ID);
    await readings.poll(PROJECT_ID);
    await readings.poll(PROJECT_ID);
    expect(count).toEqual({ opened: 1, closed: 0 });
    await readings.take(h.qa, "shop");
    expect(count).toEqual({ opened: 2, closed: 1 });
  });

  it("closes a kept login once its adapter is gone, and every login at stop", async () => {
    const { readings, sources, count } = await monitor();
    await readings.poll(PROJECT_ID);
    await sources.release(readings.targets().adapterIds);
    expect(count.closed).toBe(0);
    await sources.release(new Set());
    expect(count.closed).toBe(1);
    await readings.poll(PROJECT_ID);
    await sources.closeAll();
    expect(count).toEqual({ opened: 2, closed: 2 });
  });

  it("drops a kept login that read nothing, and opens a fresh one on the next poll", async () => {
    const { h, readings, count } = await monitor();
    await readings.poll(PROJECT_ID);
    const key = h.sftpKey.current;
    h.sftpKey.current = "SHA256:rotated";
    await readings.poll(PROJECT_ID);
    expect(count).toEqual({ opened: 1, closed: 1 });
    h.sftpKey.current = key;
    await readings.poll(PROJECT_ID);
    expect(count).toEqual({ opened: 2, closed: 1 });
  });
});

describe("the monitor's series (#101)", () => {
  it("answers the contract", async () => {
    const { readings } = await monitor();
    await readings.poll(PROJECT_ID);
    expectContract(readingSeriesSchema, await readings.series("shop", {}), (clone) => {
      clone["step_seconds"] = 0;
    });
  });

  it("buckets every value: the lowest, the mean and the highest sample in each step", async () => {
    const { h, readings, load } = await monitor();
    // Past the reading the setup took, so the first bucket holds only these four.
    h.advance(60_000);
    const start = h.now().toISOString();
    for (const value of [1, 3, 5, 7]) {
      load(value);
      await readings.poll(PROJECT_ID);
      h.advance(30_000);
    }
    const series = await readings.series("shop", {
      from: start,
      to: h.now().toISOString(),
      step: 60,
    });
    const line = series.lines.find((item) => item.key === "load_1m");
    expect(line?.name).toBe("drop");
    expect(line?.unit).toBe("load");
    expect(line?.points).toEqual([
      { t: start, min: 1, avg: 2, max: 3 },
      { t: new Date(Date.parse(start) + 60_000).toISOString(), min: 5, avg: 6, max: 7 },
    ]);
  });

  it("leaves out samples outside the window", async () => {
    const { h, readings } = await monitor();
    await readings.poll(PROJECT_ID);
    h.advance(3_600_000);
    const from = h.now().toISOString();
    h.advance(60_000);
    await readings.poll(PROJECT_ID);
    const series = await readings.series("shop", { from, step: 60 });
    expect(series.lines.find((item) => item.key === "load_1m")?.points.length).toBe(1);
  });

  it("refuses a window that ends before it starts", async () => {
    const { readings } = await monitor();
    await expect(
      readings.series("shop", { from: "2026-10-11T10:00:00.000Z", to: "2026-10-11T09:00:00.000Z" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", message: "from must be before to" });
  });

  it("refuses a step that would hold more than 1000 points", async () => {
    const { readings } = await monitor();
    await expect(
      readings.series("shop", {
        from: "2026-10-04T00:00:00.000Z",
        to: "2026-10-11T00:00:00.000Z",
        step: 60,
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
