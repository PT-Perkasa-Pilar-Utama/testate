import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as v from "valibot";

import { readEnvFile } from "./envfile.ts";
import { dataDirFrom, planSetup, portFrom } from "./setup.ts";

// docs/decisions/2026-10-10-cli.md: setup keeps the key, says nothing secret, and is idempotent.
const entry = new URL("../index.ts", import.meta.url).pathname;
const KEY = "TESTATE_SECRETS_ACTIVE_KEY";

function setup(home: string, args: string[] = [], env: Record<string, string> = {}) {
  const result = Bun.spawnSync([process.execPath, entry, "setup", ...args], {
    env: { PATH: Bun.env.PATH ?? "", HOME: home, ...env },
    timeout: 10_000,
  });
  return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
}

const envFile = (home: string): string => join(home, ".config", "testate", "testate.env");
const fresh = (): string => mkdtempSync(join(tmpdir(), "testate-setup-"));
const PASSWORD = { TESTATE_ADMIN_PASSWORD: "first-admin-password-1" };
/** The key in the env file under `home`; throws when there is none. */
const keyIn = (home: string): string => v.parse(v.string(), readEnvFile(envFile(home))?.get(KEY));

describe("planSetup", () => {
  const answers = { dataDir: "/srv/testate", port: "7378", password: null };

  it("keeps an existing key and reports no change when nothing differs", () => {
    const existing = new Map([
      [KEY, "kept-key"],
      ["TESTATE_DATA_DIR", "/srv/testate"],
      ["PORT", "7378"],
    ]);
    const plan = planSetup(existing, answers, () => "new-key");
    expect([plan.values.get(KEY), plan.changed, plan.keyGenerated]).toEqual([
      "kept-key",
      false,
      false,
    ]);
  });

  it("generates a key only when there is none", () => {
    const plan = planSetup(new Map(), answers, () => "new-key");
    expect([plan.values.get(KEY), plan.changed, plan.keyGenerated]).toEqual([
      "new-key",
      true,
      true,
    ]);
  });
});

describe("answers setup accepts", () => {
  it("expands ~/ and refuses a relative data directory", () => {
    expect(dataDirFrom("~/td", { HOME: "/home/tina" })).toBe("/home/tina/td");
    expect(() => dataDirFrom("td", { HOME: "/home/tina" })).toThrow(
      "the data directory must be absolute: td"
    );
  });

  it("refuses a port outside 1 to 65535", () => {
    expect(portFrom("8080")).toBe("8080");
    expect(() => portFrom("70000")).toThrow("the port must be a whole number from 1 to 65535");
  });
});

describe("testate setup --yes", () => {
  it("writes the env file and the data directory, and keeps the key on a second run", () => {
    const home = fresh();
    const first = setup(home, ["--yes"], PASSWORD);
    const key = keyIn(home);
    const second = setup(home, ["--yes"], PASSWORD);
    expect([first.code, second.code]).toEqual([0, 0]);
    expect(key.length).toBe(44);
    expect(keyIn(home)).toBe(key);
    expect(second.out).toContain("nothing changed");
    expect(statSync(envFile(home)).mode & 0o777).toBe(0o600);
    expect(existsSync(join(home, ".local", "share", "testate"))).toBe(true);
  });

  it("never prints the key or the password", () => {
    const home = fresh();
    const run = setup(home, ["--yes"], PASSWORD);
    const key = keyIn(home);
    expect(run.out + run.err).not.toContain(key);
    expect(run.out + run.err).not.toContain(PASSWORD.TESTATE_ADMIN_PASSWORD);
  });

  it("refuses without a first admin password, and without a terminal unless --yes", () => {
    const home = fresh();
    const answers = [setup(home, ["--yes"]), setup(home)];
    expect(answers.map((a) => a.code)).toEqual([1, 1]);
    expect(answers[0]?.err).toContain("--yes needs TESTATE_ADMIN_PASSWORD");
    expect(answers[1]?.err).toContain("no terminal to ask on");
    expect(existsSync(envFile(home))).toBe(false);
  });

  it("refuses a flag that would change a value already in the file", () => {
    const home = fresh();
    setup(home, ["--yes", "--port", "7400"], PASSWORD);
    const changed = setup(home, ["--yes", "--port", "7500"], PASSWORD);
    expect(changed.code).toBe(1);
    expect(changed.err).toContain("PORT is already 7400");
    expect(readEnvFile(envFile(home))?.get("PORT")).toBe("7400");
  });
});
