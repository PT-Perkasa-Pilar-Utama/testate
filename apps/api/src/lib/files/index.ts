import type { Entry } from "@testate/shared";

import { AppError, notFound } from "../http/index.ts";

/** A directory page; `next_cursor` is driver-defined and opaque to callers (11 §11.1). */
export type ListQuery = { cursor?: string; limit: number; q?: string };
export type ListPage = { data: Entry[]; next_cursor: string | null };

/**
 * The read-only file port (05 §5.11): three protocols look like one directory tree. Paths are
 * relative to the adapter's root or prefix and never contain `..`. No write and no delete exist.
 */
export type FileSource = {
  list(path: string, query: ListQuery): Promise<ListPage>;
  stat(path: string): Promise<Entry>;
  read(path: string): Promise<ReadableStream<Uint8Array>>;
  close(): Promise<void>;
};

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
