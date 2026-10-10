import { describe, expect, it } from "bun:test";
import type { LogsQuery } from "@testate/shared";
import * as v from "valibot";

import { containerReader, readContainer } from "./read.ts";
import type { ContainerRead } from "./read.ts";
import { FAKE_START, fakeDocker, fakeLines } from "../../../../test/docker.ts";
import type { FakeLine } from "../../../../test/docker.ts";

// #88, K5 (docs/decisions/2026-10-10-docker.md): Docker takes `tail` before `since` and `until`,
// and stamps can step back, so pages find their place by the line itself, never by a time.
function stepBack(lines: FakeLine[]): FakeLine[] {
  // Line 6 stamped 42 ms before line 5, as Engine 29.5 wrote it in the spike.
  return lines.map((line, n) =>
    n === 5 ? { ...line, nanos: (lines[4]?.nanos ?? 0n) - 42_000_000n } : line
  );
}

const query = (patch: Partial<LogsQuery> = {}): LogsQuery => ({
  source: "api",
  limit: 10,
  ...patch,
});
const texts = (read: ContainerRead): string[] => read.lines.map((line) => line.text);
const numbers = (from: number, to: number): string[] =>
  Array.from({ length: from - to + 1 }, (_, n) => `line ${from - n}`);

function container(lines: FakeLine[]) {
  const daemon = fakeDocker([{ name: "api", lines }]);
  return { daemon, read: containerReader(daemon, "api", false) };
}

describe("a container's log", () => {
  it("pages newest first back to its start, past the first tail, with no line twice or missed", async () => {
    const { read } = container(stepBack(fakeLines(25)));
    const first = await readContainer(read, query());
    const second = await readContainer(read, query({ cursor: v.parse(v.string(), first.cursor) }));
    const third = await readContainer(read, query({ cursor: v.parse(v.string(), second.cursor) }));
    expect([...texts(first), ...texts(second), ...texts(third)]).toEqual(numbers(25, 1));
    expect([first.cutBy, third.cursor, third.cutBy]).toEqual(["lines", null, null]);
  });

  it("finds its place again when lines arrive between two pages", async () => {
    const lines = fakeLines(28);
    const { read } = container(lines.slice(0, 25));
    const first = await readContainer(read, query());
    const { read: later } = container(lines);
    const older = await readContainer(later, query({ cursor: v.parse(v.string(), first.cursor) }));
    expect(texts(older)).toEqual(numbers(15, 6));
  });

  it("follows with only the lines after the newest shown, one stamped before it too", async () => {
    const lines = fakeLines(25);
    const { read } = container(lines);
    const first = await readContainer(read, query());
    const quiet = await readContainer(read, query({ after: first.after }));
    const last = FAKE_START + 24_000_000_000n;
    lines.push(
      { nanos: last - 1_000_000_000n, stream: "stderr", text: "late stamp" },
      { nanos: last + 2_000_000_000n, stream: "stdout", text: "line 27" }
    );
    const next = await readContainer(read, query({ after: quiet.after }));
    const again = await readContainer(read, query({ after: next.after }));
    expect([texts(quiet), texts(next), texts(again)]).toEqual([[], ["line 27", "late stamp"], []]);
  });

  it("pages a window that ends long before the log does, past a ceiling's worth of later lines", async () => {
    const early = fakeLines(25);
    const later = fakeLines(30, FAKE_START + 3_600_000_000_000n).map((line) => ({
      ...line,
      text: "x".repeat(1024 * 1024),
    }));
    const { read } = container([...early, ...later]);
    const to = new Date(Number((FAKE_START + 24_000_000_000n) / 1_000_000n)).toISOString();
    const first = await readContainer(read, query({ to }));
    const second = await readContainer(
      read,
      query({ to, cursor: v.parse(v.string(), first.cursor) })
    );
    const third = await readContainer(
      read,
      query({ to, cursor: v.parse(v.string(), second.cursor) })
    );
    expect([...texts(first), ...texts(second), ...texts(third)]).toEqual(numbers(25, 1));
    expect([first.cutBy, third.cursor]).toEqual(["lines", null]);
  });

  it("says bytes when the ceiling stops a read before its tail", async () => {
    const big = fakeLines(12).map((line) => ({ ...line, text: "x".repeat(1024 * 1024) }));
    const { read } = container(big);
    const page = await readContainer(read, query({ limit: 20 }));
    expect([page.cutBy, page.cursor, page.lines.length < 12]).toEqual(["bytes", null, true]);
  });

  it("refuses a cursor it did not give out", async () => {
    const { read } = container(fakeLines(3));
    await expect(readContainer(read, query({ cursor: "bm90IG91cnM" }))).rejects.toThrow(
      "that cursor was not given out by this server"
    );
  });
});
