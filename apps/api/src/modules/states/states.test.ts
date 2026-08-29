import { describe, expect, it } from "bun:test";
import { archiveManifestSchema, stateSchema, stateTreeNodeSchema } from "@testate/shared";
import * as v from "valibot";

import { TEST_META } from "../../../test/accounts.ts";
import { PG, createAdaptersHarness, createSettled } from "../../../test/adapters.ts";
import type { AdaptersHarness } from "../../../test/adapters.ts";
import { expectContract } from "../../../test/contract.ts";
import { readTar, writeTar } from "../../lib/snapshot/tar.ts";
import type { TarEntry } from "../../lib/snapshot/tar.ts";
import { ARCHIVE_MANIFEST_MOCK, STATE_MOCK, TREE_MOCK } from "./states.mock.ts";
import { createStatesService } from "./states.service.ts";
import type { StatesService } from "./states.service.ts";

const LIST = { limit: 50, sort: "created_at" as const, order: "asc" as const, includeStash: false };

async function createStatesHarness(): Promise<{ harness: AdaptersHarness; states: StatesService }> {
  const harness = await createAdaptersHarness();
  const states = createStatesService({
    repo: harness.states,
    projects: harness.projectsRepo,
    adapters: harness.repo,
    jobs: harness.runtime.jobs,
    blobs: harness.blobs,
    uploads: harness.imports,
    audit: harness.audit,
    now: harness.now,
  });
  return { harness, states };
}

async function snapshotSettled(
  h: { harness: AdaptersHarness; states: StatesService },
  name: string,
  tags: string[] = []
): Promise<string> {
  const { state, job } = await h.states.snapshot(h.harness.qa, "shop", { name, tags }, TEST_META);
  const done = await h.harness.runtime.jobs.wait(null, job.id, 5);
  expect(done.error).toBeNull();
  return state.id;
}

function initIdOf(harness: AdaptersHarness, adapterId: string): string {
  const init = harness.states.latestInit(adapterId);
  if (init === null) throw new Error("no init state");
  return init.state_id;
}

describe("states", () => {
  it("mocks match the contract", () => {
    expectContract(stateSchema, STATE_MOCK, (clone) => {
      clone["name"] = "01991f00-0000-7000-8000-000000000031";
    });
    expectContract(archiveManifestSchema, ARCHIVE_MANIFEST_MOCK, (clone) => {
      clone["adapters"] = [{ engine: "postgres" }];
    });
    expect(v.safeParse(v.array(stateTreeNodeSchema), TREE_MOCK).success).toBe(true);
  });

  it("takes a manual state over every database adapter, parented on HEAD, and moves HEAD", async () => {
    const h = await createStatesHarness();
    const adapter = await createSettled(h.harness, PG);
    const initId = initIdOf(h.harness, adapter.id);
    const id = await snapshotSettled(h, "seeded-baseline", ["baseline"]);
    const detail = await h.states.get("shop", "SEEDED-BASELINE");
    expect(detail).toMatchObject({
      id,
      kind: "manual",
      status: "ready",
      protected: false,
      tags: ["baseline"],
      parent_state_id: initId,
      actor: { kind: "user", label: "dina.qa", role: "qa" },
    });
    expect(detail.adapters[0]?.tables.map((table) => table.name)).toEqual(["customers", "orders"]);
    expect(h.harness.projectsRepo.bySlug("shop")?.head).toMatchObject({
      state_id: id,
      status: "at_state",
    });
    const tree = await h.states.tree("shop", false);
    expect(
      tree.map((node) => `${node.name}>${node.children.map((child) => child.name).join(",")}`)
    ).toEqual(["init>seeded-baseline"]);
    expect(tree[0]?.children[0]?.is_head).toBe(true);
  });

  it("lists by kind, tag, and name and hides stashes unless asked", async () => {
    const h = await createStatesHarness();
    await createSettled(h.harness, PG);
    await snapshotSettled(h, "tagged", ["x"]);
    h.harness.db.query("UPDATE states SET kind = 'stash' WHERE name = 'tagged'").run();
    expect((await h.states.list("shop", LIST)).map((state) => state.name)).toEqual(["init"]);
    expect((await h.states.list("shop", { ...LIST, includeStash: true })).length).toBe(2);
    expect((await h.states.list("shop", { ...LIST, includeStash: true, tag: "x" })).length).toBe(1);
    expect((await h.states.list("shop", { ...LIST, kind: "init" })).length).toBe(1);
    expect((await h.states.list("shop", { ...LIST, name: "init" })).length).toBe(1);
  });

  it("refuses a duplicate name, an unknown adapter, and a project without database adapters", async () => {
    const h = await createStatesHarness();
    await expect(h.states.snapshot(h.harness.qa, "shop", { name: "a" }, TEST_META)).rejects.toThrow(
      "no database adapter"
    );
    await createSettled(h.harness, PG);
    await expect(
      h.states.snapshot(h.harness.qa, "shop", { name: "Init" }, TEST_META)
    ).rejects.toThrow("state name is taken");
    await expect(
      h.states.snapshot(h.harness.qa, "shop", { name: "b", adapter_ids: ["nope"] }, TEST_META)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("protects, converts a protected stash to manual, and keeps init protected", async () => {
    const h = await createStatesHarness();
    await createSettled(h.harness, PG);
    const id = await snapshotSettled(h, "s1");
    h.harness.db.query("UPDATE states SET kind = 'stash' WHERE id = ?").run(id);
    const updated = await h.states.update(h.harness.qa, "shop", id, { protected: true }, TEST_META);
    expect(updated).toMatchObject({ kind: "manual", protected: true });
    await expect(
      h.states.update(h.harness.qa, "shop", "init", { protected: false }, TEST_META)
    ).rejects.toThrow("init states stay protected");
    await expect(h.states.remove(h.harness.qa, "shop", id, TEST_META)).rejects.toThrow(
      "state is protected"
    );
    await expect(h.states.remove(h.harness.qa, "shop", "init", TEST_META)).rejects.toThrow(
      "init states cannot be deleted"
    );
  });

  it("deletes a state, keeps shared blobs, frees unique ones, and clears HEAD", async () => {
    const h = await createStatesHarness();
    const adapter = await createSettled(h.harness, PG);
    const shared = await snapshotSettled(h, "same-data");
    h.harness.databases
      .get("shop")
      ?.set("public.orders", [{ id: 1, customer_id: 2, total: "1.00" }]);
    const changed = await snapshotSettled(h, "changed-orders");
    const before = h.harness.db.query("SELECT COUNT(*) AS n FROM blobs").get();
    expect(before).toEqual({ n: 3 });
    const job = await h.states.remove(h.harness.qa, "shop", changed, TEST_META);
    const done = await h.harness.runtime.jobs.wait(null, job.id, 5);
    expect(done.status).toBe("succeeded");
    expect(done.result).toEqual({ blobs_deleted: 1, head_cleared: true });
    expect(h.harness.db.query("SELECT COUNT(*) AS n FROM blobs").get()).toEqual({ n: 2 });
    expect(h.harness.projectsRepo.bySlug("shop")?.head.status).toBe("none");
    await expect(h.states.get("shop", changed)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await h.states.get("shop", shared)).status).toBe("ready");
    expect(h.harness.states.latestInit(adapter.id)).not.toBeNull();
  });
});

describe("state archives", () => {
  it("downloads a state as a PAX tar and imports it back as a new manual state", async () => {
    const h = await createStatesHarness();
    const adapter = await createSettled(h.harness, PG);
    const id = await snapshotSettled(h, "golden", ["release"]);
    const { state, body } = await h.states.archive("shop", id);
    expect(state.name).toBe("golden");
    const chunks: Uint8Array[] = [];
    for await (const chunk of body) chunks.push(chunk);
    const tar = Buffer.concat(chunks);
    expect(tar.byteLength % 512).toBe(0);
    const upload = await h.harness.imports.insertUpload({
      upload_id: "01991f00-0000-7000-8000-0000000000aa",
      project_id: adapter.project_id,
      file_name: "golden.tar",
      path: `${h.harness.dataDir}/golden.tar`,
      size_bytes: tar.byteLength,
      type: "tar",
      purpose: "archive",
      expires_at: "2999-01-01T00:00:00.000Z",
      created_at: "2026-08-29T00:00:00.000Z",
    });
    await Bun.write(`${h.harness.dataDir}/golden.tar`, tar);
    const manifest = await h.states.archiveManifest("shop", "01991f00-0000-7000-8000-0000000000aa");
    expect(manifest.state).toMatchObject({ name: "golden", tags: ["release"] });
    expect(manifest.adapters[0]).toMatchObject({
      archive_adapter_id: adapter.id,
      engine: "postgres",
      tables: 2,
    });
    const job = await h.states.importArchive(
      h.harness.qa,
      "shop",
      {
        upload_id: "01991f00-0000-7000-8000-0000000000aa",
        name: "golden-copy",
        adapter_mapping: [{ archive_adapter_id: adapter.id, target: { adapter_id: adapter.id } }],
      },
      TEST_META
    );
    const done = await h.harness.runtime.jobs.wait(null, job.id, 5);
    expect(done.error).toBeNull();
    const copy = await h.states.get("shop", "golden-copy");
    expect(copy).toMatchObject({
      kind: "manual",
      status: "ready",
      parent_state_id: null,
      tags: ["release"],
    });
    expect(copy.adapters[0]?.tables.map((table) => table.blob_hash)).toEqual(
      (await h.states.get("shop", id)).adapters[0]?.tables.map((table) => table.blob_hash)
    );
    expect(upload).toBeUndefined();
  });

  it("refuses an upload that is not a Testate archive", async () => {
    const h = await createStatesHarness();
    const adapter = await createSettled(h.harness, PG);
    await Bun.write(`${h.harness.dataDir}/junk.tar`, new Uint8Array(1024));
    h.harness.imports.insertUpload({
      upload_id: "01991f00-0000-7000-8000-0000000000ab",
      project_id: adapter.project_id,
      file_name: "junk.tar",
      path: `${h.harness.dataDir}/junk.tar`,
      size_bytes: 1024,
      type: "tar",
      purpose: "archive",
      expires_at: "2999-01-01T00:00:00.000Z",
      created_at: "2026-08-29T00:00:00.000Z",
    });
    await expect(
      h.states.archiveManifest("shop", "01991f00-0000-7000-8000-0000000000ab")
    ).rejects.toThrow("not a Testate archive");
  });
});

/** Every blob entry replaced by zero bytes of the same length; the manifest keeps the real hashes. */
function tamperBlobs(entries: { name: string; bytes: Uint8Array }[]): TarEntry[] {
  return entries.map((entry) => {
    const bytes = entry.name.startsWith("blobs/")
      ? new Uint8Array(entry.bytes.byteLength)
      : entry.bytes;
    return { name: entry.name, size: bytes.byteLength, body: new Blob([bytes]).stream() };
  });
}

describe("archive verification", () => {
  it("fails the import job and the state when a blob does not match its hash", async () => {
    const h = await createStatesHarness();
    const adapter = await createSettled(h.harness, PG);
    const id = await snapshotSettled(h, "golden");
    const { body } = await h.states.archive("shop", id);
    const chunks: Uint8Array[] = [];
    for await (const chunk of body) chunks.push(chunk);
    const tar = Buffer.concat(chunks);
    const entries = [...readTar(tar)];
    const tampered = tamperBlobs(entries);
    const rewritten: Uint8Array[] = [];
    for await (const chunk of writeTar(
      (async function* () {
        yield* tampered;
      })()
    ))
      rewritten.push(chunk);
    await Bun.write(`${h.harness.dataDir}/tampered.tar`, Buffer.concat(rewritten));
    h.harness.imports.insertUpload({
      upload_id: "01991f00-0000-7000-8000-0000000000ac",
      project_id: adapter.project_id,
      file_name: "tampered.tar",
      path: `${h.harness.dataDir}/tampered.tar`,
      size_bytes: 1,
      type: "tar",
      purpose: "archive",
      expires_at: "2999-01-01T00:00:00.000Z",
      created_at: "2026-08-29T00:00:00.000Z",
    });
    await h.states.removeNow(id);
    const job = await h.states.importArchive(
      h.harness.qa,
      "shop",
      {
        upload_id: "01991f00-0000-7000-8000-0000000000ac",
        name: "bad-copy",
        adapter_mapping: [{ archive_adapter_id: adapter.id, target: { adapter_id: adapter.id } }],
      },
      TEST_META
    );
    const done = await h.harness.runtime.jobs.wait(null, job.id, 5);
    expect(done.status).toBe("failed");
    expect(done.error?.message).toContain("blob hash mismatch");
    expect((await h.states.get("shop", "bad-copy")).status).toBe("failed");
  });
});
