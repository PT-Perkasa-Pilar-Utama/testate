import { describe, expect, it } from "bun:test";

import { journalCommand, shellQuote } from "./command.ts";
import type { JournalCommand } from "./command.ts";

// #86, J2 (docs/decisions/2026-10-10-journald.md): an exec channel is a shell on someone's host, so
// nothing a person typed may reach it, and every argument Testate sends is quoted.
/** What a POSIX shell makes of a quoted line: its words, with nothing run. */
async function wordsOf(line: string): Promise<string[]> {
  const proc = Bun.spawn(["sh", "-c", `for w in ${line}; do printf '%s\\n' "$w"; done`], {
    stdout: "pipe",
  });
  return (await new Response(proc.stdout).text()).split("\n").slice(0, -1);
}

describe("quoting an argument for the host's shell", () => {
  it("keeps hostile text one inert word", async () => {
    const hostile = ["'; rm -rf / #", "$(id)", "`id`", "a b\tc", "it's", "--help"];
    expect(await wordsOf(hostile.map(shellQuote).join(" "))).toEqual(hostile);
  });
});

describe("the journalctl command", () => {
  it("is the one template, every argument quoted", () => {
    expect(
      journalCommand({
        lines: 201,
        units: ["api.service", "worker@2.service"],
        since: Date.parse("2026-10-10T08:00:00.000Z"),
        until: Date.parse("2026-10-10T09:00:00.000Z"),
        cursor: { mode: "at", value: "s=abc;i=1f;b=00;m=12;t=5f;x=9" },
        reverse: true,
        level: "warn",
      })
    ).toBe(
      "'journalctl' '-o' 'json' '--no-pager' '--quiet' '-n' '201' '-r' '--since=@1791619200' '--until=@1791622800' '--cursor=s=abc;i=1f;b=00;m=12;t=5f;x=9' '-u' 'api.service' '-u' 'worker@2.service' '-p' 'warning'"
    );
  });

  it("refuses a unit, a cursor or a count outside its allow-list, before anything is sent", () => {
    const attempt = (patch: Partial<JournalCommand>) => () =>
      journalCommand({ lines: 10, units: [], ...patch });
    expect(attempt({ units: ["api.service; reboot"] })).toThrow("that unit name");
    expect(attempt({ units: ["--all"] })).toThrow("that unit name");
    expect(attempt({ cursor: { mode: "after", value: "x'$(id)" } })).toThrow("that cursor");
    expect(attempt({ lines: 0 })).toThrow("that line count");
  });
});
