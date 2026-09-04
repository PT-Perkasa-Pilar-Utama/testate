import type { Actor, Entry, JsonObject } from "@testate/shared";

import { alreadyThere, normalizePath, notAFile } from "../../lib/files/index.ts";
import type { RequestMeta } from "../../lib/http/auth.ts";
import type { ResolvedFiles } from "../adapters/adapters.files.ts";

/**
 * Everything a tester does to a file store, as opposed to everything anyone can read from one.
 *
 * It is its own file because every one of these has the same three-step shape: open an adapter a
 * write may reach, do the one thing, write down that it happened. The reading half shares neither
 * the mode check nor the audit row.
 */
export type StorageWrites = {
  /** Writes a file to a sandbox adapter, overwriting whatever is at that path. */
  upload(
    actor: Actor,
    slug: string,
    adapterId: string,
    path: string,
    body: Uint8Array,
    meta: RequestMeta
  ): Promise<Entry>;
  /**
   * Renames one file on a sandbox adapter, which is also how it moves to another directory.
   * Directories are refused, and so is a destination that already holds something.
   */
  rename(
    actor: Actor,
    slug: string,
    adapterId: string,
    path: string,
    to: string,
    meta: RequestMeta
  ): Promise<Entry>;
  /**
   * Copies one file on a sandbox adapter: read through Testate, written at `to`. Directories are
   * refused, and so is a destination that already holds something.
   */
  copy(
    actor: Actor,
    slug: string,
    adapterId: string,
    path: string,
    to: string,
    meta: RequestMeta
  ): Promise<Entry>;
  /** Deletes one file from a sandbox adapter. Directories are refused. */
  remove(
    actor: Actor,
    slug: string,
    adapterId: string,
    path: string,
    meta: RequestMeta
  ): Promise<void>;
  /** Makes an empty folder. Uploading already makes the folders above the file it writes. */
  makeDirectory(
    actor: Actor,
    slug: string,
    adapterId: string,
    path: string,
    meta: RequestMeta
  ): Promise<Entry>;
  /** Removes a folder with nothing in it; one that still holds a file is refused. */
  removeDirectory(
    actor: Actor,
    slug: string,
    adapterId: string,
    path: string,
    meta: RequestMeta
  ): Promise<void>;
};

/** What the write half borrows from the service around it: the mode check and the audit row. */
export type WriteContext = {
  writable(actor: Actor, slug: string, adapterId: string): Promise<ResolvedFiles>;
  record(
    actor: Actor,
    action: string,
    adapter: ResolvedFiles["adapter"],
    slug: string,
    path: string,
    details: JsonObject,
    meta: RequestMeta
  ): void;
};

export function createStorageWrites(ctx: WriteContext): StorageWrites {
  return {
    async upload(actor, slug, adapterId, path, body, meta) {
      const clean = normalizePath(path);
      if (clean === "") throw notAFile(clean);
      const { adapter, source } = await ctx.writable(actor, slug, adapterId);
      try {
        await source.put(clean, body);
        ctx.record(actor, "file.uploaded", adapter, slug, clean, { bytes: body.byteLength }, meta);
        // Awaited, not returned bare: a bare `return promise` inside a try enters the finally at
        // once, so `close()` would tear the connection down while this stat is still in flight.
        // SFTP ends the transport and FTP closes the control connection, either of which turns a
        // write that landed into an error the caller sees while the audit row says it succeeded.
        return await source.stat(clean);
      } finally {
        await source.close();
      }
    },
    async rename(actor, slug, adapterId, path, to, meta) {
      const from = normalizePath(path);
      const target = normalizePath(to);
      if (from === "" || target === "") throw notAFile(from === "" ? from : target);
      const { adapter, source } = await ctx.writable(actor, slug, adapterId);
      try {
        await source.move(from, target);
        ctx.record(actor, "file.renamed", adapter, slug, from, { to: target }, meta);
        return await source.stat(target);
      } finally {
        await source.close();
      }
    },
    async copy(actor, slug, adapterId, path, to, meta) {
      const from = normalizePath(path);
      const target = normalizePath(to);
      if (from === "" || target === "") throw notAFile(from === "" ? from : target);
      const { adapter, source } = await ctx.writable(actor, slug, adapterId);
      try {
        const entry = await source.stat(from);
        if (entry.kind === "directory") throw notAFile(from);
        // No store here copies in place across every engine, and an S3 copy is the one that
        // could: the bytes pass through Testate, which is the cost of one rule for all three.
        const taken = await source.stat(target).then(
          () => true,
          () => false
        );
        if (taken) throw alreadyThere(target);
        const bytes = new Uint8Array(await new Response(await source.read(from)).arrayBuffer());
        await source.put(target, bytes);
        ctx.record(
          actor,
          "file.copied",
          adapter,
          slug,
          from,
          { to: target, bytes: bytes.byteLength },
          meta
        );
        return await source.stat(target);
      } finally {
        await source.close();
      }
    },
    async remove(actor, slug, adapterId, path, meta) {
      const clean = normalizePath(path);
      const { adapter, source } = await ctx.writable(actor, slug, adapterId);
      try {
        await source.remove(clean);
        ctx.record(actor, "file.deleted", adapter, slug, clean, {}, meta);
      } finally {
        await source.close();
      }
    },
    async makeDirectory(actor, slug, adapterId, path, meta) {
      const clean = normalizePath(path);
      if (clean === "") throw notAFile(clean);
      const { adapter, source } = await ctx.writable(actor, slug, adapterId);
      try {
        await source.makeDirectory(clean);
        ctx.record(actor, "folder.created", adapter, slug, clean, {}, meta);
        return await source.stat(clean);
      } finally {
        await source.close();
      }
    },
    async removeDirectory(actor, slug, adapterId, path, meta) {
      const clean = normalizePath(path);
      const { adapter, source } = await ctx.writable(actor, slug, adapterId);
      try {
        await source.removeDirectory(clean);
        ctx.record(actor, "folder.deleted", adapter, slug, clean, {}, meta);
      } finally {
        await source.close();
      }
    },
  };
}
