/** Content-addressed blob storage (15 §15.2). `put` hashes the stream; nothing partial is addressable. */
export type BlobStore = {
  put(stream: ReadableStream<Uint8Array>, opts: { expectedHash?: string }): Promise<PutResult>;
  get(hash: string): ReadableStream<Uint8Array>;
  has(hash: string): Promise<boolean>;
  stat(hash: string): Promise<{ size: number } | null>;
  delete(hash: string): Promise<void>;
  list(): AsyncIterable<{ hash: string; size: number }>;
};

export type PutResult = { hash: string; size: number; existed: boolean };

export type Hashed = { hash: string; size: number; bytes: Uint8Array[] };

/** Drains a stream while hashing it; the local and memory drivers both start here. */
export async function collectHashed(stream: ReadableStream<Uint8Array>): Promise<Hashed> {
  const hasher = new Bun.CryptoHasher("sha256");
  const bytes: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of stream) {
    hasher.update(chunk);
    bytes.push(chunk);
    size += chunk.byteLength;
  }
  return { hash: hasher.digest("hex"), size, bytes };
}

export function assertHash(expected: string | undefined, actual: string): void {
  if (expected !== undefined && expected !== actual) {
    throw new Error(`blob hash mismatch: expected ${expected}, got ${actual}`);
  }
}

export { createLocalBlobStore } from "./local.ts";
export { createMemoryBlobStore } from "./memory.ts";
export { createS3BlobStore } from "./s3.ts";
export type { S3StoreConfig } from "./s3.ts";
export { createSwitchableBlobStore } from "./switchable.ts";
export type { SwitchableBlobStore } from "./switchable.ts";
