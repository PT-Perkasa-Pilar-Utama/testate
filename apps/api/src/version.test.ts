import { describe, expect, it } from "bun:test";

import { VERSION } from "./version.ts";

const rootPackage = new URL("../../../package.json", import.meta.url).pathname;

describe("version", () => {
  it("matches the root package.json the image is tagged from", async () => {
    const manifest: { version: string } = await Bun.file(rootPackage).json();
    // `bun run bump-version <version>` writes both; this fails when only one moved.
    expect(VERSION).toBe(manifest.version);
  });
});
