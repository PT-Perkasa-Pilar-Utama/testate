import { describe, expect, it } from "bun:test";
import * as v from "valibot";

import { TEST_META } from "../../../test/accounts.ts";
import { S3, createAdaptersHarness, createSettled } from "../../../test/adapters.ts";
import type { AdaptersHarness } from "../../../test/adapters.ts";
import type { MemoryTree } from "../../lib/files/index.ts";
import { createStorageService } from "./storage.service.ts";
import type { StorageService } from "./storage.service.ts";

const encoder = new TextEncoder();
const AT = "2026-08-28T00:00:00.000Z";

type Harness = { harness: AdaptersHarness; storage: StorageService; s3: string; tree: MemoryTree };

async function createHarness(): Promise<Harness> {
  const harness = await createAdaptersHarness();
  const s3 = await createSettled(harness, S3);
  const tree: MemoryTree = new Map();
  tree.set("exports/report.csv", { bytes: encoder.encode("a,b\n1,2\n"), modified_at: AT });
  tree.set("readme.md", { bytes: encoder.encode("# hi"), modified_at: AT });
  harness.trees.set("exports", tree);
  const storage = createStorageService({
    projects: harness.projectsRepo,
    files: harness.files,
    hostKeys: harness.hostKeys,
    audit: harness.audit,
    now: harness.now,
  });
  return { harness, storage, s3: s3.id, tree };
}

const actionRow = v.object({ action: v.string() });

function actions(harness: AdaptersHarness): string[] {
  const rows = harness.db
    .query("SELECT action FROM audit_logs WHERE target_type = 'file' ORDER BY created_at")
    .all();
  return rows.map((row) => v.parse(actionRow, row).action);
}

describe("renaming a file", () => {
  it("answers with the entry at its new path and leaves nothing at the old one", async () => {
    const h = await createHarness();
    const moved = await h.storage.rename(
      h.harness.qa,
      "shop",
      h.s3,
      "exports/report.csv",
      "exports/2026/report.csv",
      TEST_META
    );
    expect(moved).toMatchObject({ name: "report.csv", path: "exports/2026/report.csv" });
    await expect(
      h.storage.stat(h.harness.qa, "shop", h.s3, "exports/report.csv")
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(actions(h.harness)).toStrictEqual(["file.renamed"]);
  });

  it("refuses to land on something, so a rename never destroys a file", async () => {
    const h = await createHarness();
    await expect(
      h.storage.rename(h.harness.qa, "shop", h.s3, "exports/report.csv", "readme.md", TEST_META)
    ).rejects.toMatchObject({ code: "CONFLICT" });
    // Both still there, and nothing written down: the refusal is not an event.
    expect((await h.storage.stat(h.harness.qa, "shop", h.s3, "readme.md")).size_bytes).toBe(4);
    expect(actions(h.harness)).toStrictEqual([]);
  });

  it("refuses a rename on a read-only adapter", async () => {
    const h = await createHarness();
    // Who may ask is the route's rule and roles.test.ts pins it. Which adapters answer is this
    // service's, and read_only is the default: an admin loosens one on purpose or nothing writes.
    h.harness.repo.setMode(h.s3, "read_only", AT);
    await expect(
      h.storage.rename(h.harness.qa, "shop", h.s3, "readme.md", "notes.md", TEST_META)
    ).rejects.toMatchObject({ code: "ADAPTER_READ_ONLY" });
  });
});

describe("a folder with nothing in it", () => {
  it("is made, listed, and removed again", async () => {
    const h = await createHarness();
    const made = await h.storage.makeDirectory(
      h.harness.qa,
      "shop",
      h.s3,
      "exports/2027",
      TEST_META
    );
    expect(made).toMatchObject({ kind: "directory", path: "exports/2027" });
    const listing = await h.storage.list(h.harness.qa, "shop", h.s3, { path: "exports" });
    expect(listing.data.map((entry) => `${entry.kind}:${entry.name}`)).toContain("directory:2027");
    // Empty means empty: the marker that holds it open is not a file anybody put there.
    expect(
      (await h.storage.list(h.harness.qa, "shop", h.s3, { path: "exports/2027" })).data
    ).toStrictEqual([]);
    await h.storage.removeDirectory(h.harness.qa, "shop", h.s3, "exports/2027", TEST_META);
    await expect(h.storage.stat(h.harness.qa, "shop", h.s3, "exports/2027")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(actions(h.harness)).toStrictEqual(["folder.created", "folder.deleted"]);
  });

  it("is refused twice over, and a folder holding a file is not swept away", async () => {
    const h = await createHarness();
    await expect(
      h.storage.makeDirectory(h.harness.qa, "shop", h.s3, "exports", TEST_META)
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      h.storage.removeDirectory(h.harness.qa, "shop", h.s3, "exports", TEST_META)
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await h.storage.stat(h.harness.qa, "shop", h.s3, "exports")).kind).toBe("directory");
  });
});
