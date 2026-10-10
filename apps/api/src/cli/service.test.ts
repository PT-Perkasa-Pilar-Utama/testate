import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { App } from "../index.ts";
import { writeEnvFile } from "./envfile.ts";
import type { Os } from "./paths.ts";
import { restartService, serviceWith } from "./service.ts";
import type { RunResult, ServiceDeps } from "./service.ts";

// docs/decisions/2026-10-10-cli.md, Q1: a per-user unit or LaunchAgent, driven through a runner.
const OK: RunResult = { code: 0, out: "", err: "" };

function machine(os: Os, binary: string | null = "/opt/testate/testate") {
  const home = mkdtempSync(join(tmpdir(), "testate-service-"));
  const envFile = join(home, ".config", "testate", "testate.env");
  writeEnvFile(envFile, new Map([["PORT", "7378"]]), []);
  const ran: string[] = [];
  const deps: ServiceDeps = {
    os,
    binary,
    uid: 501,
    run: (command) => {
      ran.push(command.join(" "));
      return OK;
    },
  };
  const env = { HOME: home, USER: "tina" };
  const ctx = (args: string[]) => ({
    args,
    env,
    version: "9.9.9",
    boot: (): Promise<App> => Promise.reject(new Error("no boot in a service test")),
  });
  return { home, envFile, ran, deps, env, ctx };
}

describe("testate service on Linux", () => {
  it("writes a user unit that starts testate with the env file, enables it, and asks for linger", async () => {
    const m = machine("linux");
    await serviceWith(m.ctx(["install"]), m.deps);
    const unit = readFileSync(join(m.home, ".config/systemd/user/testate.service"), "utf8");
    expect(unit).toContain(`ExecStart="/opt/testate/testate" start --env-file "${m.envFile}"`);
    expect(unit).toContain("Restart=on-failure");
    expect(m.ran).toEqual([
      "systemctl --user daemon-reload",
      "systemctl --user enable --now testate.service",
      "loginctl show-user tina -p Linger",
      "loginctl enable-linger tina",
    ]);
  });

  it("removes the unit on uninstall and leaves the env file", async () => {
    const m = machine("linux");
    await serviceWith(m.ctx(["install"]), m.deps);
    m.ran.length = 0;
    await serviceWith(m.ctx(["uninstall"]), m.deps);
    expect(existsSync(join(m.home, ".config/systemd/user/testate.service"))).toBe(false);
    expect(existsSync(m.envFile)).toBe(true);
    expect(m.ran).toEqual([
      "systemctl --user disable --now testate.service",
      "systemctl --user daemon-reload",
    ]);
  });

  it("restarts the service after an update only when one is installed", async () => {
    const m = machine("linux");
    const before = restartService(m.deps, m.env);
    await serviceWith(m.ctx(["install"]), m.deps);
    m.ran.length = 0;
    expect([before, restartService(m.deps, m.env)]).toEqual([false, true]);
    expect(m.ran).toEqual(["systemctl --user restart testate.service"]);
  });
});

describe("testate service on macOS", () => {
  it("writes a LaunchAgent, replaces any loaded copy, and bootstraps it", async () => {
    const m = machine("darwin");
    await serviceWith(m.ctx(["install"]), m.deps);
    const plist = readFileSync(
      join(m.home, "Library/LaunchAgents/io.testate.server.plist"),
      "utf8"
    );
    expect(plist).toContain(`<string>${m.envFile}</string>`);
    expect(plist).toContain("<key>SuccessfulExit</key><false/>");
    expect(existsSync(join(m.home, ".local/state/testate"))).toBe(true);
    expect(m.ran).toEqual([
      "launchctl bootout gui/501/io.testate.server",
      `launchctl bootstrap gui/501 ${join(m.home, "Library/LaunchAgents/io.testate.server.plist")}`,
    ]);
  });
});

describe("what testate service refuses", () => {
  it("refuses outside the standalone binary, without an env file, and on Windows", async () => {
    const underBun = machine("linux", null);
    const noEnv = machine("linux");
    const windows = machine("win32");
    await expect(serviceWith(underBun.ctx(["install"]), underBun.deps)).rejects.toThrow(
      "service install needs the standalone testate binary, not bun"
    );
    await expect(
      serviceWith(noEnv.ctx(["install", "--env-file", "/nowhere.env"]), noEnv.deps)
    ).rejects.toThrow("no env file at /nowhere.env; run testate setup first");
    await expect(serviceWith(windows.ctx(["install"]), windows.deps)).rejects.toThrow(
      "testate service is not available on Windows yet"
    );
    expect([underBun.ran, noEnv.ran, windows.ran]).toEqual([[], [], []]);
  });

  it("refuses status with no service installed, and an unknown action", async () => {
    const m = machine("linux");
    await expect(serviceWith(m.ctx(["status"]), m.deps)).rejects.toThrow(
      "no service installed; run testate service install"
    );
    await expect(serviceWith(m.ctx(["restart"]), m.deps)).rejects.toThrow(
      "service takes one of: install, uninstall, start, stop, status, logs"
    );
  });
});

describe("when Linux has no user session", () => {
  it("says why systemctl --user failed and what to do", async () => {
    const m = machine("linux");
    const deps: ServiceDeps = {
      ...m.deps,
      run: () => ({ code: 1, out: "", err: "Failed to connect to bus: No medium found" }),
    };
    await expect(serviceWith(m.ctx(["install"]), deps)).rejects.toThrow(
      "This shell has no user session (ssh -T, su, or a script)"
    );
  });
});
