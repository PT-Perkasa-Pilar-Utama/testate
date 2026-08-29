import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

import { assertHash, collectHashed } from "./index.ts";
import type { BlobStore } from "./index.ts";

/** `blobs/<first two hex>/<hash>`; written as `<hash>.tmp`, synced, then renamed (15 §15.1). */
export function createLocalBlobStore(root: string): BlobStore {
  const pathOf = (hash: string): string => join(root, hash.slice(0, 2), hash);
  return {
    async put(stream, opts) {
      const { hash, size, bytes } = await collectHashed(stream);
      assertHash(opts.expectedHash, hash);
      const target = pathOf(hash);
      if (existsSync(target)) return { hash, size, existed: true };
      mkdirSync(join(root, hash.slice(0, 2)), { recursive: true });
      const tmp = `${target}.${Bun.randomUUIDv7()}.tmp`;
      const writer = Bun.file(tmp).writer();
      for (const chunk of bytes) writer.write(chunk);
      await writer.end();
      renameSync(tmp, target);
      return { hash, size, existed: false };
    },
    get: (hash) => Bun.file(pathOf(hash)).stream(),
    has: async (hash) => existsSync(pathOf(hash)),
    async stat(hash) {
      const path = pathOf(hash);
      return existsSync(path) ? { size: statSync(path).size } : null;
    },
    async delete(hash) {
      rmSync(pathOf(hash), { force: true });
    },
    async *list() {
      if (!existsSync(root)) return;
      for (const shard of readdirSync(root)) {
        const dir = join(root, shard);
        if (!statSync(dir).isDirectory()) continue;
        for (const name of readdirSync(dir)) {
          if (name.endsWith(".tmp")) continue;
          yield { hash: name, size: statSync(join(dir, name)).size };
        }
      }
    },
  };
}
