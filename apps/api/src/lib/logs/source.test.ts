import { describe, expect, it } from "bun:test";
import type { LogSource, LogsQuery } from "@testate/shared";

import { splitGlob } from "./read.ts";
import type { LogFile, LogFiles } from "./read.ts";
import { readSource } from "./source.ts";

// Q6, S2 and the parser rules (docs/decisions/2026-10-10-logs-tier.md), against files in memory.
const encoder = new TextEncoder();
const at = (second: number): string => new Date(Date.UTC(2026, 9, 10, 8, 0, second)).toISOString();

/** Files in memory, with a count of the bytes and files read, so a test can see what was opened. */
function memory(files: Record<string, { text: string; modified: number }>) {
  const stats = { reads: 0, bytes: 0 };
  const source: LogFiles = {
    list: async (dir) =>
      Object.entries(files)
        .filter(([path]) => path.startsWith(dir === "" ? "" : `${dir}/`))
        .map(([path, file]): LogFile => ({
          name: path.slice(path.lastIndexOf("/") + 1),
          path,
          size: encoder.encode(file.text).length,
          modified: file.modified,
        })),
    readRange: async (path, start, end) => {
      stats.reads += 1;
      stats.bytes += end - start;
      return encoder.encode(files[path]?.text ?? "").slice(start, end);
    },
  };
  return { source, stats, files };
}

const PM2: LogSource = { name: "api", glob: "logs/api-*.log", format: "pm2", patterns: [] };
const query = (extra: Partial<LogsQuery> = {}): LogsQuery => ({
  source: "api",
  limit: 200,
  ...extra,
});
const line = (second: number, text: string): string => `${at(second)}: ${text}\n`;

/** Every page back to the start of the source: the messages' second word, in page order. */
async function pageAll(source: LogFiles, limit: number): Promise<string[]> {
  const seen: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 40; page += 1) {
    const ask = query({ limit });
    if (cursor !== null) ask.cursor = cursor;
    const answer = await readSource(source, PM2, ask);
    seen.push(...answer.entries.map((entry) => entry.message.split(" ")[1] ?? ""));
    cursor = answer.cursor;
    if (cursor === null) break;
  }
  return seen;
}

/** Changes a file in memory: appends to it, or replaces it as a rotation does. */
function write(
  files: Record<string, { text: string; modified: number }>,
  path: string,
  text: string,
  append: boolean
): void {
  const file = files[path];
  if (file === undefined) throw new Error(`no file ${path}`);
  file.text = append ? file.text + text : text;
}

describe("reading a source", () => {
  it("merges pm2's out and error logs by time, joins a stack trace, and names each file", async () => {
    const { source } = memory({
      "logs/api-out.log": { text: line(1, "GET /orders") + line(3, "GET /refund"), modified: 3 },
      "logs/api-error.log": {
        text: `${line(2, "TypeError: x is undefined")}    at handler (server.ts:42)\n`,
        modified: 2,
      },
      "logs/worker-out.log": { text: line(4, "not mine"), modified: 4 },
    });
    const page = await readSource(source, PM2, query());
    expect(page.entries.map((entry) => [entry.file, entry.level, entry.message])).toEqual([
      ["api-out.log", "info", "GET /refund"],
      ["api-error.log", "error", "TypeError: x is undefined\n    at handler (server.ts:42)"],
      ["api-out.log", "info", "GET /orders"],
    ]);
    expect([page.cursor, page.cutBy, page.untimed]).toEqual([null, null, false]);
  });

  it("pages back through a 3 MB file to its start, every line once, never a whole read", async () => {
    const lines = Array.from({ length: 30_000 }, (_, n) =>
      line(n % 60, `request ${n} ${"x".repeat(60)}`)
    );
    const { source, stats } = memory({ "logs/api-out.log": { text: lines.join(""), modified: 1 } });
    const seen = await pageAll(source, 5000);
    expect(new Set(seen).size).toBe(30_000);
    expect(seen.length).toBe(30_000);
    // Each page reads about what it needs, doubling from 256 KB, never the whole file per page.
    expect(stats.bytes).toBeLessThan(lines.join("").length * 2.5);
  });

  it("follows: after returns only what was written since, and a rotated file starts over", async () => {
    const store = memory({ "logs/api-out.log": { text: line(1, "first"), modified: 1 } });
    const first = await readSource(store.source, PM2, query());
    write(store.files, "logs/api-out.log", line(2, "second"), true);
    const next = await readSource(store.source, PM2, query({ after: first.after }));
    write(store.files, "logs/api-out.log", line(3, "after rotation"), false);
    const rotated = await readSource(store.source, PM2, query({ after: next.after }));
    expect([next.entries.map((e) => e.message), rotated.entries.map((e) => e.message)]).toEqual([
      ["second"],
      ["after rotation"],
    ]);
  });

  it("reads a file without timestamps in file order, newest last line first, and says so", async () => {
    const { source } = memory({
      "logs/api-out.log": { text: "booting\nlistening\nready\n", modified: 9 },
    });
    const page = await readSource(source, PM2, query());
    expect([page.entries.map((e) => e.message), page.untimed]).toEqual([
      ["ready", "listening", "booting"],
      true,
    ]);
  });

  it("filters by level and above, by text, and by window, and names the window when it cut", async () => {
    const text =
      line(1, "INFO boot") +
      line(2, "WARN slow ORDER-9") +
      line(3, "ERROR boom ORDER-9") +
      line(4, "INFO ok");
    const { source } = memory({ "logs/api-out.log": { text, modified: Date.parse(at(4)) } });
    const level = await readSource(source, PM2, query({ level: "warn" }));
    const words = await readSource(source, PM2, query({ text: "order-9", level: "error" }));
    const window = await readSource(source, PM2, query({ from: at(3) }));
    expect([
      level.entries.length,
      words.entries.map((e) => e.message),
      window.entries.length,
      window.cutBy,
    ]).toEqual([2, ["boom ORDER-9"], 2, "window"]);
  });

  it("stops at the newest rotated files once the page is full, instead of opening all hundred", async () => {
    const files: Record<string, { text: string; modified: number }> = {};
    for (let n = 0; n < 100; n += 1)
      files[`logs/api-out-${n}.log`] = {
        text: line(n % 60, `rotated ${n}`),
        modified: Date.parse(at(n % 60)) - (100 - n) * 60_000,
      };
    files["logs/api-out.log"] = {
      text: Array.from({ length: 10 }, (_, s) => line(s, `live ${s}`)).join(""),
      modified: Date.parse(at(59)),
    };
    const { source, stats } = memory(files);
    const page = await readSource(source, PM2, query({ limit: 5 }));
    expect([page.entries.length, page.cutBy, stats.reads]).toEqual([5, "lines", 1]);
  });

  it("splits a glob into its directory and a matcher on the file name", () => {
    const glob = splitGlob("logs/api-*.log");
    expect([
      glob.dir,
      glob.matches("api-out.log"),
      glob.matches("api.log.1"),
      splitGlob("*.log").dir,
    ]).toEqual(["logs", true, false, ""]);
  });
});
