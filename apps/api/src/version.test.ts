import { describe, expect, it } from "bun:test";

import { VERSION } from "./version.ts";

const rootPackage = new URL("../../../package.json", import.meta.url).pathname;
const entry = new URL("./index.ts", import.meta.url).pathname;

describe("version", () => {
  it("matches the root package.json the image is tagged from", async () => {
    const manifest: { version: string } = await Bun.file(rootPackage).json();
    // `bun run bump-version <version>` writes both; this fails when only one moved.
    expect(VERSION).toBe(manifest.version);
  });

  // #53: the install script runs `testate --version` on a fresh binary, with nothing configured.
  it("prints the version for --version and -v with no environment, and exits 0", () => {
    const run = (flag: string) =>
      Bun.spawnSync([process.execPath, entry, flag], {
        env: { PATH: Bun.env.PATH },
        timeout: 10_000,
      });
    const answers = ["--version", "-v"].map(run);
    expect(answers.map((r) => [r.exitCode, r.stdout.toString()])).toEqual([
      [0, `testate ${VERSION}\n`],
      [0, `testate ${VERSION}\n`],
    ]);
  });
});
