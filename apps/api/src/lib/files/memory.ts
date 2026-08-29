import type { Entry } from "@testate/shared";

import { byName, missing, nameOf, normalizePath, pageEntries } from "./index.ts";
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
    async close() {},
  };
}
