import { describe, expect, it } from "bun:test";
import { readingSchema } from "@testate/shared";

import { expectContract } from "../../../test/contract.ts";
import { PG, S3, createAdaptersHarness, createSettled } from "../../../test/adapters.ts";
import type { AdaptersHarness } from "../../../test/adapters.ts";
import { SFTP } from "../../../test/files.ts";
import type { MemoryFile } from "../../lib/files/memory.ts";
import { createReadingsRepository } from "./readings.repository.ts";
import { createReadingsService } from "./readings.service.ts";
import type { ReadingsService } from "./readings.service.ts";
import { readingSources } from "./readings.sources.ts";

const bytes = (text: string): MemoryFile => ({
  bytes: new TextEncoder().encode(text),
  modified_at: "2026-10-11T00:00:00.000Z",
});

function readingsOf(h: AdaptersHarness): ReadingsService {
  return createReadingsService({
    repo: createReadingsRepository(h.db),
    projects: h.projectsRepo,
    adapters: h.repo,
    ...readingSources({ engines: h.engines, ring: h.ring, files: h.files }),
    now: h.now,
  });
}

/** A Postgres adapter, an SFTP login with a readable /proc, and an S3 store, which has no host. */
async function shop(): Promise<{ h: AdaptersHarness; readings: ReadingsService }> {
  const h = await createAdaptersHarness();
  await createSettled(h, PG);
  await createSettled(h, S3);
  await h.adapters.create(h.qa, "shop", SFTP, { ip: null, user_agent: null, request_id: null });
  h.trees.set(
    "sftp.sit.internal",
    new Map([
      ["proc/loadavg", bytes("0.50 0.40 0.30 1/200 999\n")],
      ["proc/stat", bytes("cpu  1 2 3\ncpu0 1 2 3\n")],
      ["proc/uptime", bytes("120.4 200.0\n")],
    ])
  );
  return { h, readings: readingsOf(h) };
}

describe("resource readings (#38)", () => {
  it("answers the contract", () => {
    expectContract(
      readingSchema,
      {
        id: "01991f00-0000-7000-8000-0000000000d1",
        taken_at: "2026-10-11T09:00:00.000Z",
        actor: { kind: "user", label: "tina" },
        adapters: [
          {
            adapter_id: "01991f00-0000-7000-8000-000000000020",
            name: "orders-db",
            engine: "postgres",
            source: "server",
            values: [{ key: "connections", value: 3, unit: "count" }],
            unavailable: [],
          },
        ],
      },
      (clone) => {
        clone["adapters"] = [{ source: "cluster" }];
      }
    );
  });

  it("reads the database server and the SFTP host, and leaves S3 out", async () => {
    const { h, readings } = await shop();
    const { reading, stats } = await readings.take(h.qa, "shop");
    // Adapters come in the project's order, by name.
    expect(reading.adapters.map((item) => [item.name, item.source])).toEqual([
      ["drop", "host"],
      ["orders-db", "server"],
    ]);
    const host = reading.adapters[0];
    expect(host?.values.find((item) => item.key === "load_1m")?.value).toBe(0.5);
    expect(host?.values.find((item) => item.key === "disk_free")?.value).toBe(250 * 4096);
    // The fake host has no /proc/meminfo: those four values say why, the rest stand.
    expect(host?.unavailable.map((item) => item.key)).toEqual([
      "memory_total",
      "memory_available",
      "swap_total",
      "swap_free",
    ]);
    expect(stats.adapters).toBe(2);
  });

  it("keeps the reading when one adapter cannot be reached, and says why", async () => {
    const { h, readings } = await shop();
    h.blocked.add("sftp.sit.internal");
    const { reading } = await readings.take(h.qa, "shop");
    expect(reading.adapters[0]?.unavailable).toEqual([
      { key: "adapter", reason: expect.stringContaining("sftp.sit.internal") },
    ]);
    expect(reading.adapters[1]?.values.length).toBeGreaterThan(0);
  });

  it("stores a reading, lists it newest first, and reads it back", async () => {
    const { h, readings } = await shop();
    const first = (await readings.take(h.qa, "shop")).reading;
    h.advance(1000);
    const second = (await readings.take(h.admin, "shop")).reading;
    const page = await readings.list("shop", 10);
    expect(page.rows.map((item) => item.id)).toEqual([second.id, first.id]);
    expect(await readings.get("shop", first.id)).toEqual(first);
    expect(second.actor.label).toBe(h.admin.label);
  });

  it("sweeps readings older than the job history", async () => {
    const { h, readings } = await shop();
    await readings.take(h.qa, "shop");
    h.advance(31 * 86_400_000);
    await readings.take(h.qa, "shop");
    expect(readings.sweep(30)).toBe(1);
    expect((await readings.list("shop", 10)).rows.length).toBe(1);
  });

  it("refuses a project that does not exist", async () => {
    const { h, readings } = await shop();
    await expect(readings.take(h.qa, "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
