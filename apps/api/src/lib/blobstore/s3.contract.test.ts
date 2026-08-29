import { describe, expect, test } from "bun:test";
import { S3Client } from "bun";

import { createS3BlobStore } from "./s3.ts";

/** Contract test against the compose MinIO (127.0.0.1:9010, bucket `exports`); skipped when absent. */
const CONFIG = {
  bucket: "exports",
  prefix: "store-contract",
  region: "us-east-1",
  endpoint: "http://127.0.0.1:9010",
  virtual_hosted: false,
  access_key_id: "testate",
  secret_access_key: "testate-minio",
};

async function reachable(): Promise<boolean> {
  try {
    await new S3Client({
      bucket: CONFIG.bucket,
      endpoint: CONFIG.endpoint,
      region: CONFIG.region,
      accessKeyId: CONFIG.access_key_id,
      secretAccessKey: CONFIG.secret_access_key,
    }).list({ maxKeys: 1 });
    return true;
  } catch {
    return false;
  }
}

function streamOf(text: string): ReadableStream<Uint8Array> {
  return new Blob([text]).stream();
}

describe.skipIf(!(await reachable()))("s3 blob store (contract)", () => {
  test("put dedupes by hash, verifies the size, and get, stat, list, delete agree", async () => {
    const store = createS3BlobStore(CONFIG, async () => undefined);
    const body = `blob-${Bun.randomUUIDv7()}`;
    const first = await store.put(streamOf(body), {});
    expect(first.existed).toBe(false);
    const second = await store.put(streamOf(body), { expectedHash: first.hash });
    expect(second).toEqual({ ...first, existed: true });
    await expect(store.put(streamOf(body), { expectedHash: "0".repeat(64) })).rejects.toThrow(
      "blob hash mismatch"
    );
    expect(await store.has(first.hash)).toBe(true);
    expect(await store.stat(first.hash)).toEqual({ size: body.length });
    expect(await new Response(store.get(first.hash)).text()).toBe(body);
    const listed: string[] = [];
    for await (const item of store.list()) listed.push(item.hash);
    expect(listed).toContain(first.hash);
    await store.delete(first.hash);
    expect(await store.has(first.hash)).toBe(false);
    expect(await store.stat(first.hash)).toBeNull();
  });
});
