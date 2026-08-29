import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FileSink } from "./sink.ts";
import type { WideEventRecord } from "./event.ts";

function record(name: string): WideEventRecord {
  return {
    ts: "2026-08-29T10:00:00.000Z",
    kind: "boot",
    level: "info",
    sampled: true,
    status: null,
    durationMs: 0,
    sections: { op: { name } },
  };
}

describe("log sink", () => {
  it("appends to the day's file across restarts", () => {
    const dir = mkdtempSync(join(tmpdir(), "testate-sink-"));
    const options = { dir, retentionDays: 30, stdout: false };
    for (const name of ["first", "second", "third"]) {
      // A fresh sink per name is a fresh process: the day's file must survive it.
      const sink = new FileSink(options);
      sink.write(record(name));
      sink.close();
    }
    const lines = readFileSync(join(dir, "testate-2026-08-29.jsonl"), "utf8")
      .split("\n")
      .filter((line) => line !== "");
    expect(lines.length).toBe(3);
    expect(lines.map((line) => JSON.parse(line).op.name)).toStrictEqual([
      "first",
      "second",
      "third",
    ]);
  });
});
