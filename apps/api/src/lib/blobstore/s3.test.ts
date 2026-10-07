import { describe, expect, it, mock } from "bun:test";
import { S3Client } from "bun";

import { createS3BlobStore } from "./s3.ts";
import type { S3StoreConfig } from "./s3.ts";
import type { Check, Verdict } from "../netguard/index.ts";

const CONFIG: S3StoreConfig = {
  bucket: "snapshots",
  prefix: "testate",
  region: "us-east-1",
  endpoint: "http://store.example.test:9000",
  virtual_hosted: true,
  access_key_id: "test",
  secret_access_key: "test-secret",
};
const HASH = "a".repeat(64);

function clientWithBlob(options: ConstructorParameters<typeof S3Client>[0]): S3Client {
  const client = new S3Client(options);
  client.exists = async () => true;
  return client;
}

describe("S3 store outbound address pinning", () => {
  it("refuses a denied target before constructing a client, including a lazy read", async () => {
    const createClient = mock(clientWithBlob);
    const store = createS3BlobStore(
      CONFIG,
      undefined,
      async () => ({ allowed: false, reason: "policy", matched: "192.0.2.8" }),
      createClient
    );

    await expect(store.has(HASH)).rejects.toMatchObject({
      code: "HOST_BLOCKED",
      details: { reason: "policy", matched: "192.0.2.8" },
    });
    await expect(new Response(store.get(HASH)).text()).rejects.toMatchObject({
      code: "HOST_BLOCKED",
      details: { reason: "policy", matched: "192.0.2.8" },
    });
    expect(createClient.mock.calls).toEqual([]);
  });

  it.each([
    ["192.0.2.8", "http://192.0.2.8:9000"],
    ["2001:db8::8", "http://[2001:db8::8]:9000"],
  ])("uses the checked HTTP address %s and path-style buckets", async (address, endpoint) => {
    const createClient = mock(clientWithBlob);
    const check = mock(async (_input: Check): Promise<Verdict> => ({
      allowed: true,
      addresses: [address],
    }));
    const store = createS3BlobStore(CONFIG, undefined, check, createClient);

    expect(await store.has(HASH)).toBe(true);
    expect(check.mock.calls).toEqual([
      [{ host: "store.example.test", port: 9000, purpose: "store" }],
    ]);
    expect(createClient.mock.calls).toEqual([
      [expect.objectContaining({ endpoint, virtualHostedStyle: false, bucket: "snapshots" })],
    ]);
  });

  it("keeps HTTPS hostname verification and virtual hosting after checking the target", async () => {
    const createClient = mock(clientWithBlob);
    const check = mock(async (_input: Check): Promise<Verdict> => ({
      allowed: true,
      addresses: ["192.0.2.8"],
    }));
    const store = createS3BlobStore(
      { ...CONFIG, endpoint: "https://store.example.test" },
      undefined,
      check,
      createClient
    );

    expect(await store.has(HASH)).toBe(true);
    expect(check.mock.calls).toEqual([
      [{ host: "store.example.test", port: 443, purpose: "store" }],
    ]);
    expect(createClient.mock.calls).toEqual([
      [
        expect.objectContaining({
          endpoint: "https://store.example.test",
          virtualHostedStyle: true,
        }),
      ],
    ]);
  });

  it("rechecks each operation and creates a new client when the checked address changes", async () => {
    const createClient = mock(clientWithBlob);
    const check = mock(async (_input: Check): Promise<Verdict> => ({
      allowed: true,
      addresses: ["192.0.2.8"],
    }));
    const store = createS3BlobStore(CONFIG, undefined, check, createClient);

    expect(await store.has(HASH)).toBe(true);
    expect(await store.has(HASH)).toBe(true);
    check.mockResolvedValue({ allowed: true, addresses: ["192.0.2.9"] });
    expect(await store.has(HASH)).toBe(true);
    check.mockResolvedValue({ allowed: false, reason: "policy", matched: "192.0.2.9" });
    await expect(store.has(HASH)).rejects.toMatchObject({
      code: "HOST_BLOCKED",
      details: { reason: "policy", matched: "192.0.2.9" },
    });
    expect(check.mock.calls).toHaveLength(4);
    expect(createClient.mock.calls).toEqual([
      [expect.objectContaining({ endpoint: "http://192.0.2.8:9000" })],
      [expect.objectContaining({ endpoint: "http://192.0.2.9:9000" })],
    ]);
  });
});
