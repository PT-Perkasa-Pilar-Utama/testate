import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { preMigrationCopy } from "./boot.ts";
import { preMigrationCopies } from "../test/boot-copies.ts";

describe("boot", () => {
  it("copies the metadata database before migrations and keeps the last three", () => {
    const dir = mkdtempSync(join(tmpdir(), "testate-boot-"));
    mkdirSync(join(dir, "run"), { recursive: true });
    expect(preMigrationCopy(dir, "01a0-first")).toBeNull();

    writeFileSync(join(dir, "metadata.db"), "one");
    expect(preMigrationCopy(dir, "01a0-a")).not.toBeNull();
    writeFileSync(join(dir, "metadata.db"), "two");
    for (const id of ["01a0-b", "01a0-c", "01a0-d"]) preMigrationCopy(dir, id);

    const copies = preMigrationCopies(dir);
    expect(copies).toStrictEqual([
      "metadata-01a0-b.db",
      "metadata-01a0-c.db",
      "metadata-01a0-d.db",
    ]);
    expect(readFileSync(join(dir, "run", "metadata-01a0-b.db"), "utf8")).toBe("two");
  });
});
