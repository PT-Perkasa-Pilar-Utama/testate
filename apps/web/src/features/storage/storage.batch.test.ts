import { describe, expect, test } from "bun:test";
import type { Entry } from "@testate/shared";

import { destinationOf, moveOrCopy } from "./storage.batch.ts";

const entry = (name: string, kind: Entry["kind"]): Entry => ({
  name,
  path: `in/${name}`,
  kind,
  size_bytes: 1,
  modified_at: null,
});

/** A store that refuses one destination, and remembers every call it was asked for. */
function fakeCalls() {
  const seen: string[] = [];
  return {
    seen,
    calls: {
      rename: async (path: string, to: string): Promise<Entry> => {
        seen.push(`mv ${path} ${to}`);
        if (path.endsWith("taken.csv")) throw new Error("something is already at that path");
        return entry(to, "file");
      },
      copy: async (path: string, to: string): Promise<Entry> => {
        seen.push(`cp ${path} ${to}`);
        return entry(to, "file");
      },
    },
  };
}

describe("moving or copying the ticked entries", () => {
  test("a folder path and a name make the destination; the root has no prefix", () => {
    expect(destinationOf("exports/2026/", "a.csv")).toBe("exports/2026/a.csv");
    expect(destinationOf("  ", "a.csv")).toBe("a.csv");
  });

  test("files go one by one, folders stay, and a refusal is named rather than thrown", async () => {
    const { calls, seen } = fakeCalls();
    const rows = [entry("a.csv", "file"), entry("taken.csv", "file"), entry("docs", "directory")];
    expect(await moveOrCopy("move", rows, "out", calls)).toEqual({
      done: 1,
      failed: ["taken.csv", "docs"],
    });
    expect(await moveOrCopy("copy", [entry("b.csv", "file")], "", calls)).toEqual({
      done: 1,
      failed: [],
    });
    expect(seen).toEqual([
      "mv in/a.csv out/a.csv",
      "mv in/taken.csv out/taken.csv",
      "cp in/b.csv b.csv",
    ]);
  });
});
