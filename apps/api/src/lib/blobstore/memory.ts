import { assertHash, collectHashed } from "./index.ts";
import type { BlobStore } from "./index.ts";

/** Map-backed store for tests. */
export function createMemoryBlobStore(): BlobStore {
  const blobs = new Map<string, Uint8Array>();
  return {
    async put(stream, opts) {
      const { hash, size, bytes } = await collectHashed(stream);
      assertHash(opts.expectedHash, hash);
      const existed = blobs.has(hash);
      if (!existed) blobs.set(hash, Buffer.concat(bytes.map((chunk) => Buffer.from(chunk))));
      return { hash, size, existed };
    },
    get(hash) {
      const bytes = blobs.get(hash);
      return new ReadableStream<Uint8Array>({
        start(controller) {
          if (bytes !== undefined) controller.enqueue(bytes);
          controller.close();
        },
      });
    },
    has: async (hash) => blobs.has(hash),
    async stat(hash) {
      const bytes = blobs.get(hash);
      return bytes === undefined ? null : { size: bytes.byteLength };
    },
    async delete(hash) {
      blobs.delete(hash);
    },
    async *list() {
      for (const [hash, bytes] of blobs) yield { hash, size: bytes.byteLength };
    },
  };
}
