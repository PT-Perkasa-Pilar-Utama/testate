import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

  it("sweeps files past retention but never the one it is writing", () => {
    const dir = mkdtempSync(join(tmpdir(), "testate-sink-"));
    writeFileSync(join(dir, "testate-2026-01-01.jsonl"), "{}\n");
    const sink = new FileSink({ dir, retentionDays: 1, stdout: false });
    sink.write(record("replayed"));
    sink.close();
    expect(existsSync(join(dir, "testate-2026-01-01.jsonl"))).toBe(false);
    const kept = readFileSync(join(dir, "testate-2026-08-29.jsonl"), "utf8").trim();
    expect(JSON.parse(kept).op.name).toBe("replayed");
  });
});
