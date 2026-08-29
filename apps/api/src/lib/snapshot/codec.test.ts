import { describe, expect, it } from "bun:test";

import { createMemoryBlobStore } from "../blobstore/index.ts";
import { rowText } from "../engines/types.ts";
import type { EncodedRow } from "../engines/types.ts";
import { decodeChunks, decodeLine, encodeChunks, encodeLine } from "./codec.ts";

const ROWS: EncodedRow[] = [
  {
    key: { by: "primary-key", value: [1] },
    json: rowText('{"id": 1, "big": 123456789012345.6789, "note": "a,\\"r\\":b"}'),
  },
  { key: { by: "primary-key", value: [2, "x"] }, json: rowText('{"id": 2, "name": null}') },
  { key: { by: "row-hash", value: "abc123" }, json: rowText('{"v": [1, 2, {"k": "nested"}]}') },
];

async function* rows(): AsyncIterable<EncodedRow> {
  for (const row of ROWS) yield row;
}

async function bytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const part of stream) parts.push(part);
  return Buffer.concat(parts.map((part) => Buffer.from(part)));
}

describe("snapshot codec", () => {
  it("keeps the row text verbatim through a line round trip", () => {
    for (const row of ROWS) {
      const decoded = decodeLine(encodeLine(row).trimEnd());
      expect(decoded.json).toBe(row.json);
      expect(decoded.key).toStrictEqual(row.key);
    }
  });

  it("round-trips through gzip and produces identical bytes for identical rows", async () => {
    const first = await bytes(encodeChunks(rows()));
    const second = await bytes(encodeChunks(rows()));
    expect(Buffer.compare(Buffer.from(first), Buffer.from(second))).toBe(0);
    const decoded: EncodedRow[] = [];
    for await (const row of decodeChunks(new Blob([first]).stream())) decoded.push(row);
    expect(decoded).toStrictEqual(ROWS);
  });

  it("dedups in the blob store by content hash", async () => {
    const store = createMemoryBlobStore();
    const one = await store.put(encodeChunks(rows()), {});
    const two = await store.put(encodeChunks(rows()), {});
    expect(two.hash).toBe(one.hash);
    expect(two.existed).toBe(true);
    await expect(store.put(encodeChunks(rows()), { expectedHash: "deadbeef" })).rejects.toThrow(
      "hash mismatch"
    );
    expect(await store.stat(one.hash)).toStrictEqual({ size: one.size });
  });

  it("rejects a malformed line", () => {
    expect(() => decodeLine('{"x":1}')).toThrow("malformed");
  });
});
