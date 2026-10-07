import { describe, expect, it, mock } from "bun:test";
import { S3Client } from "bun";

import { createS3Source } from "./s3.ts";
import type { S3SourceConfig } from "./s3.ts";

const CONFIG: S3SourceConfig = {
  bucket: "exports",
  prefix: "",
  region: "us-east-1",
  endpoint: "http://files.example.test:9000",
  address: "192.0.2.8",
  port: 9000,
  virtual_hosted: true,
  accessKeyId: "test",
  secretAccessKey: "test-secret",
};

describe("S3 source outbound address pinning", () => {
  it.each([
    ["192.0.2.8", "http://192.0.2.8:9000"],
    ["2001:db8::8", "http://[2001:db8::8]:9000"],
  ])(
    "lists through the checked HTTP address %s with path-style buckets",
    async (address, endpoint) => {
      const createClient = mock((options: ConstructorParameters<typeof S3Client>[0]) => {
        const client = new S3Client(options);
        client.list = async () => ({ contents: [{ key: "orders.csv", size: 12 }] });
        return client;
      });
      const source = createS3Source({ ...CONFIG, address }, createClient);

      const page = await source.list("", { limit: 10 });

      expect(createClient.mock.calls).toEqual([
        [expect.objectContaining({ endpoint, virtualHostedStyle: false, bucket: "exports" })],
      ]);
      expect(page.data).toEqual([
        { name: "orders.csv", path: "orders.csv", kind: "file", size_bytes: 12, modified_at: null },
      ]);
    }
  );

  it("keeps the HTTPS hostname and virtual hosting for TLS", () => {
    const createClient = mock(
      (options: ConstructorParameters<typeof S3Client>[0]) => new S3Client(options)
    );

    createS3Source({ ...CONFIG, endpoint: "https://files.example.test", port: 443 }, createClient);

    expect(createClient.mock.calls).toEqual([
      [
        expect.objectContaining({
          endpoint: "https://files.example.test",
          virtualHostedStyle: true,
        }),
      ],
    ]);
  });

  it("keeps an endpoint unchanged when no checked address is supplied", () => {
    const { address: _address, ...config } = CONFIG;
    const createClient = mock(
      (options: ConstructorParameters<typeof S3Client>[0]) => new S3Client(options)
    );

    createS3Source(config, createClient);

    expect(createClient.mock.calls).toEqual([
      [
        expect.objectContaining({
          endpoint: "http://files.example.test:9000",
          virtualHostedStyle: true,
        }),
      ],
    ]);
  });
});
