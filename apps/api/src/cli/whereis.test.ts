import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeEnvFile } from "./envfile.ts";
import { places, row } from "./whereis.ts";

// docs/decisions/2026-10-10-cli.md, Q3: whereis answers "where is my config" without the docs.
const entry = new URL("../index.ts", import.meta.url).pathname;

function whereis(home: string, args: string[] = []) {
  const result = Bun.spawnSync([process.execPath, entry, "whereis", ...args], {
    env: { PATH: Bun.env.PATH ?? "", HOME: home },
    timeout: 10_000,
  });
  return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
}

describe("testate whereis", () => {
  it("says what is missing before setup has run", () => {
    const home = mkdtempSync(join(tmpdir(), "testate-whereis-"));
    const states = places({ HOME: home }, "linux", undefined, "9.9.9").map((p) => p.state);
    expect(states).toEqual([
      "missing (run testate setup)",
      "missing",
      "not the standalone binary",
      "not installed",
      "",
    ]);
  });

  it("reads the data directory from the env file, and prints one path for scripts", () => {
    const home = mkdtempSync(join(tmpdir(), "testate-whereis-"));
    const file = join(home, ".config", "testate", "testate.env");
    writeEnvFile(file, new Map([["TESTATE_DATA_DIR", "/srv/elsewhere"]]), []);
    const answers = [whereis(home, ["env"]), whereis(home, ["data"])];
    expect(answers.map((a) => [a.code, a.out])).toEqual([
      [0, `${file}\n`],
      [0, "/srv/elsewhere\n"],
    ]);
  });

  it("refuses a name it does not know with exit 2", () => {
    const answer = whereis(mkdtempSync(join(tmpdir(), "testate-whereis-")), ["config"]);
    expect([answer.code, answer.err]).toEqual([
      2,
      "testate: whereis takes one of: env, data, bin, service, log\n",
    ]);
  });

  it("shows the home directory as ~ in the table", () => {
    const line = row(
      { name: "env", path: "/home/tina/.config/x", state: "exists" },
      { HOME: "/home/tina" }
    );
    expect(line).toBe(`env      ${"exists".padEnd(28)} ~/.config/x`);
  });
});
