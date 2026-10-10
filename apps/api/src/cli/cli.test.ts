import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { VERSION } from "../version.ts";
import { parseEnv, readEnvFile, withEnvFile, writeEnvFile } from "./envfile.ts";
import { defaultDataDir, defaultEnvFile, launchdLog, serviceFile } from "./paths.ts";

// docs/decisions/2026-10-10-cli.md: the command line, the paths and the env file.
const entry = new URL("../index.ts", import.meta.url).pathname;

function cli(args: string[], env: Record<string, string> = {}) {
  const result = Bun.spawnSync([process.execPath, entry, ...args], {
    env: { PATH: Bun.env.PATH ?? "", ...env },
    timeout: 10_000,
  });
  return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
}

describe("the command line", () => {
  it("prints the version for version, --version and -v", () => {
    const answers = ["version", "--version", "-v"].map((word) => cli([word]));
    expect(answers.map((a) => [a.code, a.out])).toEqual([
      [0, `testate ${VERSION}\n`],
      [0, `testate ${VERSION}\n`],
      [0, `testate ${VERSION}\n`],
    ]);
  });

  it("refuses an unknown command with the command list and exit 2, starting nothing", () => {
    const typo = cli(["strat"]);
    expect(typo.code).toBe(2);
    expect(typo.err).toContain('unknown command "strat"');
    expect(typo.err).toContain("testate start");
  });

  it("refuses an unknown option to start, and an --env-file that is not there", () => {
    const answers = [cli(["start", "--port", "1"]), cli(["--env-file", "/nowhere/testate.env"])];
    expect(answers.map((a) => a.code)).toEqual([2, 1]);
    expect(answers[1]?.err).toContain("no env file at /nowhere/testate.env");
  });

  it("prints the command list for help", () => {
    const help = cli(["help"]);
    expect([help.code, help.out.startsWith("Usage:")]).toEqual([0, true]);
  });
});

describe("where the CLI keeps things", () => {
  const home = { HOME: "/home/tina" };

  it("follows XDG on Linux and macOS, with the plist under LaunchAgents", () => {
    expect([
      defaultEnvFile(home, "linux"),
      defaultDataDir(home, "darwin"),
      serviceFile(home, "linux"),
      serviceFile(home, "darwin"),
      launchdLog(home),
    ]).toEqual([
      "/home/tina/.config/testate/testate.env",
      "/home/tina/.local/share/testate",
      "/home/tina/.config/systemd/user/testate.service",
      "/home/tina/Library/LaunchAgents/io.testate.server.plist",
      "/home/tina/.local/state/testate/testate.log",
    ]);
  });

  it("honours XDG variables, and has no default without a home directory", () => {
    const xdg = { ...home, XDG_CONFIG_HOME: "/cfg", XDG_DATA_HOME: "/data" };
    expect([
      defaultEnvFile(xdg, "linux"),
      defaultDataDir(xdg, "linux"),
      defaultEnvFile({}, "linux"),
      serviceFile(home, "win32"),
    ]).toEqual(["/cfg/testate/testate.env", "/data/testate", null, null]);
  });
});

describe("the env file", () => {
  it("parses comments, quotes and an equals sign inside a value", () => {
    const text = "# a comment\n\nPORT=7378\nNAME=\"two words\"\nKEY='a=b'\nnot a line\n";
    expect([...parseEnv(text)]).toEqual([
      ["PORT", "7378"],
      ["NAME", "two words"],
      ["KEY", "a=b"],
    ]);
  });

  it("writes mode 600 in a mode 700 directory, and reads back what it wrote", () => {
    const path = join(mkdtempSync(join(tmpdir(), "testate-env-")), "conf", "testate.env");
    const values = new Map([
      ["TESTATE_DATA_DIR", "/srv/my data"],
      ["TESTATE_SECRETS_ACTIVE_KEY", "abc+/="],
    ]);
    writeEnvFile(path, values, ["written by a test"]);
    const modes = [statSync(path).mode & 0o777, statSync(join(path, "..")).mode & 0o777];
    expect(modes).toEqual([0o600, 0o700]);
    expect(readEnvFile(path)).toEqual(values);
    expect(readFileSync(path, "utf8").startsWith("# written by a test\n")).toBe(true);
  });

  it("lets a variable already in the process win over the file", () => {
    const merged = withEnvFile(
      { PORT: "9000" },
      new Map([
        ["PORT", "7378"],
        ["TESTATE_DATA_DIR", "/srv"],
      ])
    );
    expect(merged).toEqual({ PORT: "9000", TESTATE_DATA_DIR: "/srv" });
  });

  it("boots with the default env file when it exists, and without it when it does not", () => {
    const home = mkdtempSync(join(tmpdir(), "testate-home-"));
    writeEnvFile(join(home, ".config", "testate", "testate.env"), new Map([["PORT", "abc"]]), []);
    // An invalid PORT from the file proves the file was read: boot refuses with exit 78.
    const withFile = cli([], { HOME: home });
    const without = cli([], { HOME: join(home, "nobody") });
    expect([withFile.code, without.code]).toEqual([78, 78]);
    expect(withFile.err).toContain("PORT");
    expect(without.err).not.toContain("PORT");
  });
});
