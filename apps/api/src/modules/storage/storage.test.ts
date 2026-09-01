import { describe, expect, it } from "bun:test";
import { entrySchema, previewPayloadSchema } from "@testate/shared";
import * as v from "valibot";

import { TEST_META } from "../../../test/accounts.ts";
import { PG, S3, createAdaptersHarness, createSettled } from "../../../test/adapters.ts";
import { SFTP } from "../../../test/files.ts";
import type { AdaptersHarness } from "../../../test/adapters.ts";
import { expectContract } from "../../../test/contract.ts";
import type { MemoryTree } from "../../lib/files/index.ts";
import { contentDisposition } from "./storage.handler.ts";
import { ENTRIES_MOCK, PREVIEW_CSV_MOCK } from "./storage.mock.ts";
import { collectCapped } from "./storage.preview.ts";
import { createStorageService } from "./storage.service.ts";
import type { StorageService } from "./storage.service.ts";

type Harness = {
  harness: AdaptersHarness;
  storage: StorageService;
  s3: string;
  sftp: string;
  pg: string;
};

function cursorOf(page: { next_cursor: string | null }): string {
  if (page.next_cursor === null) throw new Error("no next cursor");
  return page.next_cursor;
}

const encoder = new TextEncoder();
const AT = "2026-08-28T00:00:00.000Z";

function seed(tree: MemoryTree): void {
  tree.set("exports/export-2026-08-28.csv", {
    bytes: encoder.encode("order_id,status\n88213,paid\n88214,open\n"),
    modified_at: AT,
  });
  tree.set("exports/notes.txt", { bytes: encoder.encode("hello"), modified_at: AT });
  tree.set("exports/report.json", { bytes: encoder.encode('{"ok":true}'), modified_at: AT });
  tree.set("exports/logo.png", { bytes: new Uint8Array([137, 80, 78, 71]), modified_at: AT });
  tree.set("exports/archive.zip", { bytes: new Uint8Array([80, 75]), modified_at: AT });
  tree.set("readme.md", { bytes: encoder.encode("# hi"), modified_at: AT });
}

async function createHarness(): Promise<Harness> {
  const harness = await createAdaptersHarness();
  const pg = await createSettled(harness, PG);
  const s3 = await createSettled(harness, S3);
  const sftp = await createSettled(harness, SFTP);
  const tree: MemoryTree = new Map();
  seed(tree);
  harness.trees.set("exports", tree);
  harness.trees.set("sftp.sit.internal", tree);
  const storage = createStorageService({
    projects: harness.projectsRepo,
    files: harness.files,
    hostKeys: harness.hostKeys,
    audit: harness.audit,
    now: harness.now,
  });
  return { harness, storage, s3: s3.id, sftp: sftp.id, pg: pg.id };
}

/** A stream of 1 MiB chunks whose declared size nobody checked. */
function megabytes(count: number): ReadableStream<Uint8Array> {
  const chunk = new Uint8Array(1024 * 1024);
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      sent += 1;
      controller.enqueue(chunk);
      if (sent === count) controller.close();
    },
  });
}

async function text(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

describe("storage", () => {
  it("mocks match the contract", () => {
    expect(v.safeParse(v.array(entrySchema), ENTRIES_MOCK).success).toBe(true);
    expectContract(previewPayloadSchema, PREVIEW_CSV_MOCK, (clone) => {
      clone["kind"] = "video";
    });
  });

  it("lists directories first, filters by name, pages by cursor, and stats entries", async () => {
    const h = await createHarness();
    const root = await h.storage.list(h.harness.qa, "shop", h.s3, {});
    expect(root.data.map((entry) => `${entry.kind}:${entry.path}`)).toEqual([
      "directory:exports",
      "file:readme.md",
    ]);
    const first = await h.storage.list(h.harness.qa, "shop", h.s3, { path: "exports", limit: 2 });
    expect(first.data.map((entry) => entry.name)).toEqual(["archive.zip", "export-2026-08-28.csv"]);
    expect(first.next_cursor).toBe("2");
    const rest = await h.storage.list(h.harness.qa, "shop", h.s3, {
      path: "exports",
      limit: 2,
      cursor: cursorOf(first),
    });
    expect(rest.data.map((entry) => entry.name)).toEqual(["logo.png", "notes.txt"]);
    const found = await h.storage.list(h.harness.qa, "shop", h.s3, { path: "exports", q: "2026" });
    expect(found.data.map((entry) => entry.name)).toEqual(["export-2026-08-28.csv"]);
    const stat = await h.storage.stat(h.harness.qa, "shop", h.s3, "/exports/notes.txt");
    expect(stat).toEqual({
      name: "notes.txt",
      path: "exports/notes.txt",
      kind: "file",
      size_bytes: 5,
      modified_at: AT,
    });
    await expect(h.storage.stat(h.harness.qa, "shop", h.s3, "exports/nope")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("refuses database adapters, unknown projects, and paths that climb out of the root", async () => {
    const h = await createHarness();
    await expect(h.storage.list(h.harness.qa, "shop", h.pg, {})).rejects.toMatchObject({
      code: "ENGINE_UNSUPPORTED",
      details: { reason: "tier" },
    });
    await expect(h.storage.list(h.harness.qa, "nope", h.s3, {})).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      h.storage.stat(h.harness.qa, "shop", h.s3, "exports/../../etc/passwd")
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("previews csv, json, and text as payloads, images as bytes, and refuses the rest", async () => {
    const h = await createHarness();
    const csv = await h.storage.preview(
      h.harness.qa,
      "shop",
      h.s3,
      "exports/export-2026-08-28.csv"
    );
    expect(csv).toEqual({
      kind: "payload",
      payload: {
        kind: "csv",
        columns: ["order_id", "status"],
        rows: [
          ["88213", "paid"],
          ["88214", "open"],
        ],
        truncated: false,
      },
    });
    const json = await h.storage.preview(h.harness.qa, "shop", h.s3, "exports/report.json");
    expect(json).toEqual({
      kind: "payload",
      payload: { kind: "json", content: { ok: true }, truncated: false },
    });
    const md = await h.storage.preview(h.harness.qa, "shop", h.s3, "readme.md");
    expect(md).toEqual({
      kind: "payload",
      payload: { kind: "text", content: "# hi", truncated: false },
    });
    const png = await h.storage.preview(h.harness.qa, "shop", h.s3, "exports/logo.png");
    expect(png).toMatchObject({ kind: "binary", contentType: "image/png" });
    await expect(
      h.storage.preview(h.harness.qa, "shop", h.s3, "exports/archive.zip")
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(h.storage.preview(h.harness.qa, "shop", h.s3, "exports")).rejects.toThrow(
      "directories have no preview"
    );
  });

  it("stops reading a stream that grows past the cap when the reported size lied", async () => {
    await expect(collectCapped(megabytes(6))).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });

  it("refuses a preview over the cap and still downloads it", async () => {
    const h = await createHarness();
    const tree = h.harness.trees.get("exports");
    tree?.set("big.txt", { bytes: new Uint8Array(5 * 1024 * 1024 + 1), modified_at: AT });
    await expect(h.storage.preview(h.harness.qa, "shop", h.s3, "big.txt")).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
    });
    const download = await h.storage.download(h.harness.qa, "shop", h.s3, "exports/notes.txt");
    expect(download).toMatchObject({ name: "notes.txt", size: 5 });
    expect(await text(download.stream)).toBe("hello");
    expect(contentDisposition("attachment", 'ra"port é.csv')).toBe(
      `attachment; filename="ra_port _.csv"; filename*=UTF-8''ra%22port%20%C3%A9.csv`
    );
  });

  it("refuses a write to a read-only adapter, whoever is asking", async () => {
    const h = await createHarness();
    const { qa, admin } = h.harness;
    const bytes = new TextEncoder().encode("x");
    h.harness.repo.setMode(h.s3, "read_only", AT);
    await expect(
      h.storage.upload(qa, "shop", h.s3, "exports/new.txt", bytes, TEST_META)
    ).rejects.toMatchObject({ code: "ADAPTER_READ_ONLY" });
    await expect(
      h.storage.remove(admin, "shop", h.s3, "readme.md", TEST_META)
    ).rejects.toMatchObject({ code: "ADAPTER_READ_ONLY" });
    // Nothing was touched on the way to the refusal.
    expect((await h.storage.stat(qa, "shop", h.s3, "readme.md")).size_bytes).toBe(4);
  });

  it("uploads, overwrites and deletes on a sandbox adapter, and audits both", async () => {
    const h = await createHarness();
    const { qa } = h.harness;
    const encoder = new TextEncoder();
    const entry = await h.storage.upload(
      qa,
      "shop",
      h.s3,
      "exports/new.txt",
      encoder.encode("first"),
      TEST_META
    );
    expect(entry).toMatchObject({ name: "new.txt", kind: "file", size_bytes: 5 });
    await h.storage.upload(
      qa,
      "shop",
      h.s3,
      "exports/new.txt",
      encoder.encode("longer"),
      TEST_META
    );
    expect((await h.storage.stat(qa, "shop", h.s3, "exports/new.txt")).size_bytes).toBe(6);
    await h.storage.remove(qa, "shop", h.s3, "exports/new.txt", TEST_META);
    await expect(h.storage.stat(qa, "shop", h.s3, "exports/new.txt")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const actions = h.harness.db
      .query<{ action: string; target_label: string }, []>(
        "SELECT action, target_label FROM audit_logs WHERE action LIKE 'file.%' ORDER BY created_at"
      )
      .all();
    expect(actions.map((row) => `${row.action}:${row.target_label}`)).toEqual([
      "file.uploaded:exports/new.txt",
      "file.uploaded:exports/new.txt",
      "file.deleted:exports/new.txt",
    ]);
  });

  it("refuses to delete a directory, and to write to the root", async () => {
    const h = await createHarness();
    const { qa } = h.harness;
    await expect(h.storage.remove(qa, "shop", h.s3, "exports", TEST_META)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(
      h.storage.upload(qa, "shop", h.s3, "", new Uint8Array([1]), TEST_META)
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect((await h.storage.stat(qa, "shop", h.s3, "exports")).kind).toBe("directory");
  });

  it("trusts the SFTP host key on first use, blocks a changed key, and accepts the new one", async () => {
    const h = await createHarness();
    const listing = await h.storage.list(h.harness.qa, "shop", h.sftp, {});
    expect(listing.data.length).toBe(2);
    expect(h.harness.hostKeys.byAdapter(h.sftp)).toMatchObject({
      key_type: "ssh-ed25519",
      fingerprint: "SHA256:fake-host-key-1",
      accepted_by: h.harness.qa.id,
    });
    h.harness.sftpKey.current = "SHA256:fake-host-key-2";
    await expect(h.storage.list(h.harness.qa, "shop", h.sftp, {})).rejects.toMatchObject({
      code: "CONFLICT",
      details: { reason: "host_key_changed", details: { fingerprint: "SHA256:fake-host-key-2" } },
    });
    await expect(
      h.storage.acceptHostKey(h.harness.qa, "shop", h.sftp, "SHA256:wrong", TEST_META)
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await h.storage.acceptHostKey(
      h.harness.qa,
      "shop",
      h.sftp,
      "SHA256:fake-host-key-2",
      TEST_META
    );
    expect(h.harness.hostKeys.byAdapter(h.sftp)?.fingerprint).toBe("SHA256:fake-host-key-2");
    expect((await h.storage.list(h.harness.qa, "shop", h.sftp, {})).data.length).toBe(2);
    const audit = h.harness.db
      .query("SELECT action FROM audit_logs WHERE action = 'host_key.accepted'")
      .all();
    expect(audit.length).toBe(1);
    await expect(
      h.storage.acceptHostKey(h.harness.qa, "shop", h.s3, "SHA256:x", TEST_META)
    ).rejects.toThrow("only SFTP adapters have a host key");
  });

  it("does not let a token trust a first-seen host key", async () => {
    const h = await createHarness();
    const token = { ...h.harness.qa, kind: "token" as const };
    await expect(h.storage.list(token, "shop", h.sftp, {})).rejects.toMatchObject({
      code: "CONFLICT",
      details: { reason: "host_key_untrusted" },
    });
    expect(h.harness.hostKeys.byAdapter(h.sftp)).toBeNull();
  });
});
