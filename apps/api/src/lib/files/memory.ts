import type { Entry } from "@testate/shared";

import {
  alreadyThere,
  byName,
  missing,
  nameOf,
  normalizePath,
  notAFile,
  notEmpty,
  pageEntries,
} from "./index.ts";
import type { FileSource } from "./index.ts";

export type MemoryFile = { bytes: Uint8Array; modified_at: string };
/** Path → file; directories exist implicitly through the paths under them. */
export type MemoryTree = Map<string, MemoryFile>;

function childrenOf(tree: MemoryTree, dir: string): Entry[] {
  const prefix = dir === "" ? "" : `${dir}/`;
  const seen = new Map<string, Entry>();
  for (const [path, file] of tree) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    // The marker an empty directory is spelled with, which is this directory itself.
    if (rest === "") continue;
    const slash = rest.indexOf("/");
    if (slash === -1) {
      seen.set(rest, {
        name: rest,
        path,
        kind: "file",
        size_bytes: file.bytes.byteLength,
        modified_at: file.modified_at,
      });
    } else {
      const name = rest.slice(0, slash);
      seen.set(name, {
        name,
        path: `${prefix}${name}`,
        kind: "directory",
        size_bytes: null,
        modified_at: null,
      });
    }
  }
  return [...seen.values()].sort(byName);
}

function isDirectory(tree: MemoryTree, path: string): boolean {
  if (path === "") return true;
  const prefix = `${path}/`;
  for (const key of tree.keys()) if (key.startsWith(prefix)) return true;
  return false;
}

/** The in-memory driver behind module tests; the same tree shape the S3 driver sees. */
export function createMemorySource(tree: MemoryTree): FileSource {
  return {
    async list(path, query) {
      const dir = normalizePath(path);
      if (!isDirectory(tree, dir)) throw missing(dir);
      return pageEntries(childrenOf(tree, dir), query);
    },
    async stat(path) {
      const clean = normalizePath(path);
      const file = tree.get(clean);
      if (file !== undefined)
        return {
          name: nameOf(clean),
          path: clean,
          kind: "file",
          size_bytes: file.bytes.byteLength,
          modified_at: file.modified_at,
        };
      if (!isDirectory(tree, clean)) throw missing(clean);
      return {
        name: nameOf(clean),
        path: clean,
        kind: "directory",
        size_bytes: null,
        modified_at: null,
      };
    },
    async read(path) {
      const clean = normalizePath(path);
      const file = tree.get(clean);
      if (file === undefined) throw missing(clean);
      return new Blob([file.bytes]).stream();
    },
    async put(path, body) {
      const clean = normalizePath(path);
      if (clean === "" || isDirectory(tree, clean)) throw notAFile(clean);
      tree.set(clean, { bytes: body, modified_at: new Date().toISOString() });
    },
    async remove(path) {
      const clean = normalizePath(path);
      if (!tree.has(clean)) throw isDirectory(tree, clean) ? notAFile(clean) : missing(clean);
      tree.delete(clean);
    },
    async makeDirectory(path) {
      const clean = normalizePath(path);
      if (clean === "") throw notAFile(clean);
      if (tree.has(clean) || isDirectory(tree, clean)) throw alreadyThere(clean);
      tree.set(`${clean}/`, { bytes: new Uint8Array(), modified_at: new Date().toISOString() });
    },
    async removeDirectory(path) {
      const clean = normalizePath(path);
      if (clean === "" || !isDirectory(tree, clean)) throw missing(clean);
      if (childrenOf(tree, clean).length > 0) throw notEmpty(clean);
      tree.delete(`${clean}/`);
    },
    async move(from, to) {
      const source = normalizePath(from);
      const target = normalizePath(to);
      const file = tree.get(source);
      if (file === undefined) throw isDirectory(tree, source) ? notAFile(source) : missing(source);
      if (target === "" || isDirectory(tree, target)) throw notAFile(target);
      if (tree.has(target)) throw alreadyThere(target);
      tree.delete(source);
      tree.set(target, file);
    },
    async close() {},
  };
}
