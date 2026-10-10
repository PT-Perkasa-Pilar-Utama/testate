import { describe, expect, it } from "bun:test";
import type { JournalSource, LogsQuery } from "@testate/shared";
import * as v from "valibot";

import { readJournal } from "./read.ts";
import type { Shell } from "./read.ts";

// #86, J4: pages on journald's own cursor, newest first, an older page from the oldest line shown
// without repeating it, and follow with only what came after.
const JOURNAL = Array.from({ length: 7 }, (_, n) => ({
  __CURSOR: `s=x;i=${n + 1}`,
  __REALTIME_TIMESTAMP: String((1791619200 + n) * 1_000_000),
  PRIORITY: n === 4 ? "3" : "6",
  MESSAGE: n === 4 ? "refund failed" : `request ${n + 1}`,
  _SYSTEMD_UNIT: n % 2 === 0 ? "api.service" : "worker.service",
}));

/** A host that answers like journalctl for -n, -r, --cursor, --after-cursor and -u. */
function fakeHost(lines = JOURNAL): Shell & { commands: string[] } {
  const commands: string[] = [];
  return {
    commands,
    async run(command) {
      commands.push(command);
      const arg = (name: string) => command.match(new RegExp(`'${name}([^']*)'`))?.[1];
      const n = Number(command.match(/'-n' '(\d+)'/)?.[1]);
      const units = [...command.matchAll(/'-u' '([^']+)'/g)].map((match) => match[1]);
      const at = arg("--cursor=");
      const after = arg("--after-cursor=");
      let rows = lines.filter((row) => units.length === 0 || units.includes(row._SYSTEMD_UNIT));
      if (after !== undefined && after !== null)
        rows = rows.slice(rows.findIndex((row) => row.__CURSOR === after) + 1).slice(-n);
      else if (at !== undefined && at !== null)
        rows = rows
          .slice(0, rows.findIndex((row) => row.__CURSOR === at) + 1)
          .reverse()
          .slice(0, n);
      else rows = rows.slice(-n);
      return {
        stdout: rows.map((row) => JSON.stringify(row)).join("\n"),
        stderr: "",
        code: 0,
        capped: false,
      };
    },
    close: async () => undefined,
  };
}

const ALL: JournalSource = { name: "all", units: [], patterns: [] };
const query = (patch: Partial<LogsQuery> = {}): LogsQuery => ({
  source: "all",
  limit: 3,
  ...patch,
});
const messages = (read: { entries: { message: string }[] }) =>
  read.entries.map((entry) => entry.message);

describe("a journal source", () => {
  it("pages newest first and back to the start, without a line twice", async () => {
    const host = fakeHost();
    const first = await readJournal(host, ALL, query());
    const second = await readJournal(
      host,
      ALL,
      query({ cursor: v.parse(v.string(), first.cursor) })
    );
    const third = await readJournal(
      host,
      ALL,
      query({ cursor: v.parse(v.string(), second.cursor) })
    );
    expect([messages(first), messages(second), messages(third), third.cursor]).toEqual([
      ["request 7", "request 6", "refund failed"],
      ["request 4", "request 3", "request 2"],
      ["request 1"],
      null,
    ]);
  });

  it("follows with only the lines after the newest one shown", async () => {
    const host = fakeHost(JOURNAL.slice(0, 5));
    const first = await readJournal(host, ALL, query());
    const later = fakeHost();
    const follow = await readJournal(later, ALL, query({ after: first.after }));
    expect(messages(follow)).toEqual(["request 7", "request 6"]);
  });

  it("sends the source's units and the level to journalctl, and filters text itself", async () => {
    const host = fakeHost();
    const api: JournalSource = { name: "api", units: ["api.service"], patterns: [] };
    const read = await readJournal(host, api, query({ limit: 10, level: "error", text: "REFUND" }));
    expect([
      messages(read),
      host.commands[0]?.includes("'-u' 'api.service'"),
      host.commands[0]?.includes("'-p' 'err'"),
    ]).toEqual([["refund failed"], true, true]);
  });
});
