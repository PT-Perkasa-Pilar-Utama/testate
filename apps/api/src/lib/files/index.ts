import type { Entry } from "@testate/shared";

import { AppError, notFound } from "../http/index.ts";

/** A directory page; `next_cursor` is driver-defined and opaque to callers (11 §11.1). */
export type ListQuery = { cursor?: string; limit: number; q?: string };
export type ListPage = { data: Entry[]; next_cursor: string | null };

/**
 * The file port (05 §5.11): three protocols look like one directory tree. Paths are relative to
 * the adapter's root or prefix and never contain `..`.
 *
 * `put` and `remove` are the whole write half, and the port is deliberately that small. Whether a
 * caller may use them is not decided here: the storage service refuses an adapter that is not in
 * sandbox mode, exactly as the write session does for a database.
 */
export type FileSource = {
  list(path: string, query: ListQuery): Promise<ListPage>;
  stat(path: string): Promise<Entry>;
  read(path: string): Promise<ReadableStream<Uint8Array>>;
  /** Writes a file, making the directories above it, overwriting whatever is there. */
  put(path: string, body: Uint8Array): Promise<void>;
  /**
   * Deletes one file. A directory is refused rather than emptied: recursive delete means something
   * different on each of the three protocols, and it is the one mistake here nothing undoes.
   */
  remove(path: string): Promise<void>;
  /**
   * Renames one file, which is also how it is moved to another directory.
   *
   * A directory is refused for the same reason `remove` refuses one, and an occupied destination
   * is refused rather than overwritten: a rename that lands on an existing file destroys it with
   * nothing to undo it from, and the caller cannot see that coming.
   */
  move(from: string, to: string): Promise<void>;
  /**
   * Makes an empty directory.
   *
   * Uploading into a path that does not exist already makes the directories above it, so this is
   * only ever for the empty one a person makes before they have the file. On a key store there is
   * no such thing as an empty directory, so it writes the zero-byte `path/` key that every S3
   * browser uses to spell one, and the listing already reads that key as a directory rather than
   * as a file of its own.
   */
  makeDirectory(path: string): Promise<void>;
  /**
   * Removes an empty directory. A directory with anything in it is refused, for the same reason
   * `remove` refuses a directory at all: recursive delete is the one mistake here nothing undoes.
   */
  removeDirectory(path: string): Promise<void>;
  close(): Promise<void>;
};

/** A directory with something in it; emptying it is the caller's to do, one file at a time. */
export function notEmpty(path: string): AppError {
  return new AppError("CONFLICT", "that folder still has something in it", { path });
}

/** The destination of a move is taken; the caller decides whether to delete it first. */
export function alreadyThere(path: string): AppError {
  return new AppError("CONFLICT", "something is already at that path", { path });
}

/** A directory is not a file, and neither `put` nor `remove` pretends otherwise. */
export function notAFile(path: string): AppError {
  return new AppError("VALIDATION_ERROR", "that is a directory, not a file", { path });
}

export type HostKey = { type: string; fingerprint: string };

/** Answers whether a presented SSH host key may be trusted; the resolver implements TOFU over it. */
export type HostKeyVerifier = (key: HostKey) => boolean;

/** Normalizes a user-supplied path: no leading slash, no empty or `.` segments, and `..` is refused. */
export function normalizePath(input: string | undefined): string {
  const segments = (input ?? "").split("/").filter((part) => part !== "" && part !== ".");
  if (segments.includes(".."))
    throw new AppError("VALIDATION_ERROR", "path may not contain ..", { path: input ?? "" });
  return segments.join("/");
}

export function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function joinPath(root: string, path: string): string {
  const base = root.replace(/\/+$/, "");
  if (path === "") return base === "" ? "/" : base;
  return base === "" ? `/${path}` : `${base}/${path}`;
}

/** Filters by name, then pages by offset for drivers that list a whole directory at once. */
export function pageEntries(entries: Entry[], query: ListQuery): ListPage {
  const filtered =
    query.q === undefined ? entries : entries.filter((e) => e.name.includes(query.q ?? ""));
  const offset = query.cursor === undefined ? 0 : Number.parseInt(query.cursor, 10);
  if (!Number.isInteger(offset) || offset < 0)
    throw new AppError("VALIDATION_ERROR", "invalid cursor", { cursor: query.cursor ?? "" });
  const data = filtered.slice(offset, offset + query.limit);
  const next = offset + query.limit;
  return { data, next_cursor: next < filtered.length ? String(next) : null };
}

export function byName(a: Entry, b: Entry): number {
  if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
  return a.name.localeCompare(b.name);
}

export function missing(path: string): AppError {
  return notFound(`entry ${path}`);
}

/** Every driver failure that is not a missing entry becomes `ADAPTER_UNREACHABLE` with the driver code. */
export function unreachable(cause: unknown, code: string | undefined): AppError {
  const message = cause instanceof Error ? cause.message : String(cause);
  return new AppError("ADAPTER_UNREACHABLE", message, { code: code ?? "unknown" });
}

export { createMemorySource } from "./memory.ts";
export type { MemoryTree } from "./memory.ts";
