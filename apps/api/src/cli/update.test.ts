import { afterAll, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { App } from "../index.ts";
import { spawnRunner } from "./service.ts";
import { archiveName, newer, updateWith } from "./update.ts";
import type { UpdateDeps } from "./update.ts";

// docs/decisions/2026-10-10-cli.md, Q2: update swaps in a verified release, or changes nothing.
// The fake release is served over plain HTTP by Bun.serve; the field URL is fixed to HTTPS.
const OLD = '#!/bin/sh\necho "testate 1.0.0"\n';
const NEW = '#!/bin/sh\necho "testate 9.9.9"\n';
const BROKEN = "#!/bin/sh\nexit 1\n";
const NAME = archiveName("linux", "arm64");

/** A real tar.gz holding `testate` (the given script) and a LICENSE. */
function archive(script: string): Uint8Array {
  const dir = mkdtempSync(join(tmpdir(), "testate-release-"));
  writeFileSync(join(dir, "testate"), script, { mode: 0o755 });
  writeFileSync(join(dir, "LICENSE"), "MIT\n");
  Bun.spawnSync(["tar", "-czf", join(dir, NAME), "-C", dir, "testate", "LICENSE"]);
  return new Uint8Array(readFileSync(join(dir, NAME)));
}

const sha = (bytes: Uint8Array): string =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

/** Serves one release, v9.9.9, whose checksums.txt may lie about the archive. */
function release(served: Uint8Array, listed: Uint8Array = served): string {
  const server = Bun.serve({
    port: 0,
    fetch(request): Response {
      const path = new URL(request.url).pathname;
      if (path === "/latest")
        return new Response(null, { status: 302, headers: { location: "/releases/tag/v9.9.9" } });
      if (path === "/download/v9.9.9/checksums.txt")
        return new Response(`${sha(listed)}  ${NAME}\n`);
      if (path === `/download/v9.9.9/${NAME}`) return new Response(served);
      return new Response("not here", { status: 404 });
    },
  });
  const base = `http://127.0.0.1:${server.port}`;
  servers.push(server);
  return base;
}
const servers: { stop: () => void }[] = [];
afterAll(() => {
  for (const server of servers) server.stop();
});

function installed(script = OLD): string {
  const binary = join(mkdtempSync(join(tmpdir(), "testate-bin-")), "testate");
  writeFileSync(binary, script, { mode: 0o755 });
  return binary;
}

function deps(base: string, binary: string | null, fetched: string[] = []): UpdateDeps {
  return {
    base,
    binary,
    os: "linux",
    arch: "arm64",
    run: spawnRunner,
    fetch: (url, init) => {
      fetched.push(url);
      return fetch(url, init);
    },
    service: { os: "linux", run: spawnRunner, binary, uid: 0 },
  };
}

const ctx = (args: string[], version = "1.0.0") => ({
  args,
  env: { HOME: mkdtempSync(join(tmpdir(), "testate-home-")) },
  version,
  boot: (): Promise<App> => Promise.reject(new Error("no boot in an update test")),
});

describe("newer", () => {
  it("compares numerically and puts a pre-release before its release", () => {
    expect([
      newer("2.0.10", "2.0.9"),
      newer("2.0.9", "2.0.10"),
      newer("2.0.0", "2.0.0-rc.1"),
      newer("2.0.0-rc.1", "2.0.0"),
      newer("2.0.0", "2.0.0"),
    ]).toEqual([true, false, true, false, false]);
  });
});

describe("testate update", () => {
  it("swaps in the verified release and leaves no .new behind", async () => {
    const binary = installed();
    await updateWith(ctx([]), deps(release(archive(NEW)), binary));
    expect(readFileSync(binary, "utf8")).toBe(NEW);
    expect(existsSync(`${binary}.new`)).toBe(false);
  });

  it("refuses an archive that does not match checksums.txt, and changes nothing", async () => {
    const binary = installed();
    const base = release(archive(NEW), archive(OLD));
    await expect(updateWith(ctx([]), deps(base, binary))).rejects.toThrow(
      `${NAME} does not match checksums.txt; nothing was changed`
    );
    expect(readFileSync(binary, "utf8")).toBe(OLD);
  });

  it("refuses a release binary that does not run here, and changes nothing", async () => {
    const binary = installed();
    await expect(updateWith(ctx([]), deps(release(archive(BROKEN)), binary))).rejects.toThrow(
      'the new binary does not run here (it answered ""); nothing was changed'
    );
    expect([readFileSync(binary, "utf8"), existsSync(`${binary}.new`)]).toEqual([OLD, false]);
  });

  it("refuses Homebrew's binary, a non-standalone run and a folder it cannot write, before any download", async () => {
    const base = release(archive(NEW));
    const fetched: string[] = [];
    const locked = installed();
    chmodSync(join(locked, ".."), 0o555);
    await expect(
      updateWith(ctx([]), deps(base, "/opt/homebrew/Cellar/testate/2.0.0/bin/testate", fetched))
    ).rejects.toThrow("this testate came from Homebrew; run brew upgrade testate");
    await expect(updateWith(ctx([]), deps(base, null, fetched))).rejects.toThrow(
      "update works on the standalone testate binary"
    );
    await expect(updateWith(ctx([]), deps(base, locked, fetched))).rejects.toThrow("cannot write");
    chmodSync(join(locked, ".."), 0o755);
    expect(fetched).toEqual([]);
  });

  it("only reports with --check, and does nothing when already on the latest", async () => {
    const binary = installed();
    const base = release(archive(NEW));
    await updateWith(ctx(["--check"]), deps(base, binary));
    await updateWith(ctx([], "9.9.9"), deps(base, binary));
    expect(readFileSync(binary, "utf8")).toBe(OLD);
  });
});
