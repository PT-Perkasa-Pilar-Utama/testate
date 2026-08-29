import { describe, expect, it } from "bun:test";
import type { AdapterDraft } from "@testate/shared";

import { TEST_META } from "../../../test/accounts.ts";
import { PG, createSettled } from "../../../test/adapters.ts";
import { createStatesHarness, snapshotSettled } from "../../../test/states-harness.ts";
import { readTar, writeTar } from "../../lib/snapshot/tar.ts";
import type { TarEntry } from "../../lib/snapshot/tar.ts";

function idOf(item: { id: string } | undefined): string {
  if (item === undefined) throw new Error("the adapter was not created");
  return item.id;
}

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

  it("imports an archive into a new adapter created from the mapping", async () => {
    const h = await createStatesHarness();
    const adapter = await createSettled(h.harness, PG);
    const id = await snapshotSettled(h, "golden");
    const { body } = await h.states.archive("shop", id);
    const chunks: Uint8Array[] = [];
    for await (const chunk of body) chunks.push(chunk);
    const tar = Buffer.concat(chunks);
    await h.harness.imports.insertUpload({
      upload_id: "01991f00-0000-7000-8000-0000000000ab",
      project_id: adapter.project_id,
      file_name: "golden.tar",
      path: `${h.harness.dataDir}/golden2.tar`,
      size_bytes: tar.byteLength,
      type: "tar",
      purpose: "archive",
      expires_at: "2999-01-01T00:00:00.000Z",
      created_at: "2026-08-29T00:00:00.000Z",
    });
    await Bun.write(`${h.harness.dataDir}/golden2.tar`, tar);
    const wrongEngine: AdapterDraft = { ...PG, engine: "mysql", name: "m" };
    const copyDraft: AdapterDraft = { ...PG, name: "orders-db-copy" };
    await expect(
      h.states.importArchive(
        h.harness.qa,
        "shop",
        {
          upload_id: "01991f00-0000-7000-8000-0000000000ab",
          name: "wrong-engine",
          adapter_mapping: [
            {
              archive_adapter_id: adapter.id,
              target: { create: wrongEngine },
            },
          ],
        },
        TEST_META
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const job = await h.states.importArchive(
      h.harness.qa,
      "shop",
      {
        upload_id: "01991f00-0000-7000-8000-0000000000ab",
        name: "golden-on-new",
        adapter_mapping: [{ archive_adapter_id: adapter.id, target: { create: copyDraft } }],
      },
      TEST_META
    );
    const done = await h.harness.runtime.jobs.wait(null, job.id, 5);
    expect(done.error).toBeNull();
    const created = h.harness.repo
      .list(adapter.project_id, {})
      .find((item) => item.name === "orders-db-copy");
    const copy = await h.states.get("shop", "golden-on-new");
    expect(copy.adapters.map((item) => item.adapter_id)).toEqual([idOf(created)]);
  });
});
