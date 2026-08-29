import { describe, expect, test } from "bun:test";

import { readTar, writeTar } from "./tar.ts";

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

async function* entries(
  items: { name: string; text: string }[]
): AsyncIterable<{ name: string; size: number; body: ReadableStream<Uint8Array> }> {
  for (const item of items) {
    const bytes = bytesOf(item.text);
    yield { name: item.name, size: bytes.byteLength, body: new Blob([bytes]).stream() };
  }
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

describe("pax tar", () => {
  test("round-trips entries with long names and 512-byte alignment", async () => {
    const long = `blobs/${"a".repeat(140)}`;
    const items = [
      { name: "manifest.json", text: '{"version":1}' },
      { name: long, text: "x".repeat(1000) },
      { name: "adapters/empty.json", text: "" },
    ];
    const bytes = await collect(writeTar(entries(items)));
    expect(bytes.byteLength % 512).toBe(0);
    const read = [...readTar(bytes)].map((entry) => ({
      name: entry.name,
      text: new TextDecoder().decode(entry.bytes),
    }));
    expect(read).toEqual(items);
  });

  test("the writer refuses an entry whose body size differs from the declared size", async () => {
    const bad = (async function* () {
      yield { name: "a", size: 5, body: new Blob([bytesOf("abc")]).stream() };
    })();
    await expect(collect(writeTar(bad))).rejects.toThrow("expected 5 bytes");
  });
});
