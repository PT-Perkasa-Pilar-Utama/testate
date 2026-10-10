import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readSource } from "../source.ts";
import { sourceName } from "./line.ts";
import { createIngestStore } from "./store.ts";

// #75 (I2, I3, I5, I9 of docs/decisions/2026-10-10-logs-tier.md): pushed lines are filed by source
// and receive day, stamped no later than their receipt, and read back by the logfile reader.
const ADAPTER = "01a12437-4484-761c-b749-6799c4596f9d";
const NOW = new Date("2026-10-10T08:00:00.000Z");

function setup(now: () => Date = () => NOW) {
  const root = mkdtempSync(join(tmpdir(), "testate-ingest-"));
  const store = createIngestStore(root, now);
  const day = (source: string, name = "2026-10-10"): string =>
    readFileSync(join(root, ADAPTER, source, `${name}.jsonl`), "utf8");
  return { root, store, day };
}

/** A day file of `bytes` bytes written by hand, as an older push would have left it. */
function oldDay(root: string, source: string, name: string, bytes: number): void {
  mkdirSync(join(root, ADAPTER, source), { recursive: true });
  writeFileSync(join(root, ADAPTER, source, `${name}.jsonl`), "x".repeat(bytes));
}

const lines = (...items: string[]): string => `${items.join("\n")}\n`;

describe("storing a push", () => {
  it("files each line under its service and today, and counts what it kept", async () => {
    const { store, day } = setup();
    const answer = await store.write(
      ADAPTER,
      lines(
        '{"ts":"2026-10-10T07:59:00Z","level":"info","message":"paid","service":{"name":"billing"}}',
        '{"ts":"2026-10-10T07:59:01Z","level":"warn","message":"slow"}'
      ),
      1024
    );
    expect(answer).toEqual({ accepted: 2, malformed: 0 });
    expect([JSON.parse(day("billing")).message, JSON.parse(day("default")).message]).toEqual([
      "paid",
      "slow",
    ]);
  });

  it("stamps a missing ts, clamps a future one, and wraps a line that is not JSON", async () => {
    const { store, day } = setup();
    const answer = await store.write(
      ADAPTER,
      lines('{"message":"no time"}', '{"ts":"2026-10-11T00:00:00Z","message":"ahead"}', "boom"),
      1024
    );
    const [missing, ahead, raw] = day("default")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(answer).toEqual({ accepted: 3, malformed: 1 });
    expect([missing.ts, ahead.ts, ahead.ingest, raw]).toEqual([
      NOW.toISOString(),
      NOW.toISOString(),
      { sent_ts: "2026-10-11T00:00:00Z" },
      { ts: NOW.toISOString(), level: "info", message: "boom", ingest: { malformed: true } },
    ]);
  });

  it("keeps a service name to a folder name that never leaves the adapter", () => {
    expect([sourceName("../etc"), sourceName("api v2"), sourceName(""), sourceName(".x")]).toEqual([
      "_._etc",
      "api_v2",
      "default",
      "_x",
    ]);
  });

  it("refuses a body with no lines", async () => {
    const { store } = setup();
    await expect(store.write(ADAPTER, "\n \n", 1024)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

describe("the size cap", () => {
  it("removes the oldest days to make room, and never today", async () => {
    const { root, store } = setup();
    oldDay(root, "api", "2026-10-08", 600_000);
    oldDay(root, "api", "2026-10-09", 300_000);
    await store.write(ADAPTER, lines("x".repeat(300_000)), 1);
    expect(await store.files(ADAPTER).list("api")).toEqual([
      expect.objectContaining({ name: "2026-10-09.jsonl" }),
    ]);
  });

  it("answers INGEST_FULL once today alone would pass the cap, and stores nothing", async () => {
    const { root, store } = setup();
    oldDay(root, "default", "2026-10-10", 1_000_000);
    await expect(store.write(ADAPTER, lines("x".repeat(100_000)), 1)).rejects.toMatchObject({
      code: "INGEST_FULL",
    });
    expect((await store.files(ADAPTER).list("default")).map((file) => file.size)).toEqual([
      1_000_000,
    ]);
  });
});

describe("retention, clearing and reading back", () => {
  it("prunes days past retention, and clear empties the adapter", async () => {
    const { root, store } = setup();
    oldDay(root, "api", "2026-10-02", 10);
    oldDay(root, "api", "2026-10-03", 10);
    expect(await store.prune(ADAPTER, 7)).toBe(1);
    expect(await store.sources(ADAPTER)).toEqual(["api"]);
    await store.clear(ADAPTER);
    // Not an adapter id: nothing to clear, and never a path outside the root.
    await store.clear("..");
    expect([await store.sources(ADAPTER), existsSync(root)]).toEqual([[], true]);
  });

  it("reads a source back newest first through the logfile reader", async () => {
    let at = NOW;
    const { store } = setup(() => at);
    await store.write(ADAPTER, lines('{"message":"first","service":{"name":"api"}}'), 1024);
    at = new Date(NOW.getTime() + 1000);
    await store.write(ADAPTER, lines('{"message":"second","service":{"name":"api"}}'), 1024);
    const page = await readSource(
      store.files(ADAPTER),
      { name: "api", glob: "api/*.jsonl", format: "testate", patterns: [] },
      { source: "api", limit: 10 }
    );
    expect(page.entries.map((entry) => entry.message)).toEqual(["second", "first"]);
  });

  it("reads nothing outside the adapter's folder, whatever path is asked for", async () => {
    const { root, store } = setup();
    writeFileSync(join(root, "2026-10-10.jsonl"), "token");
    const files = store.files(ADAPTER);
    expect([
      await files.list(".."),
      (await files.readRange("../2026-10-10.jsonl", 0, 10)).length,
      (await files.readRange("api/../../2026-10-10.jsonl", 0, 10)).length,
    ]).toEqual([[], 0, 0]);
  });
});
