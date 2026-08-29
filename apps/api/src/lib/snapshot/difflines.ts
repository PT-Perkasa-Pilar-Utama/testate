import type { DiffRow } from "@testate/shared";
import { diffRowSchema } from "@testate/shared";
import * as v from "valibot";

/** Diff blobs: one JSON diff row per line, gzip, content-addressed like snapshots (20 §20.1). */
export function encodeDiffRows(rows: AsyncIterable<DiffRow>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator = rows[Symbol.asyncIterator]();
  const lines = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const item = await iterator.next();
      if (item.done) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(`${JSON.stringify(item.value)}\n`));
    },
    async cancel() {
      await iterator.return?.();
    },
  });
  // SAFETY: CompressionStream transforms bytes to bytes; Bun types narrow the array buffer flavour only.
  return lines.pipeThrough(
    new CompressionStream("gzip") as TransformStream<Uint8Array, Uint8Array>
  );
}

export async function* decodeDiffRows(stream: ReadableStream<Uint8Array>): AsyncIterable<DiffRow> {
  const decoder = new TextDecoder();
  let pending = "";
  // SAFETY: DecompressionStream transforms bytes to bytes; Bun types narrow the array buffer flavour only.
  const inflated = stream.pipeThrough(
    new DecompressionStream("gzip") as TransformStream<Uint8Array, Uint8Array>
  );
  for await (const chunk of inflated) {
    pending += decoder.decode(chunk, { stream: true });
    let newline = pending.indexOf("\n");
    while (newline !== -1) {
      yield v.parse(diffRowSchema, JSON.parse(pending.slice(0, newline)));
      pending = pending.slice(newline + 1);
      newline = pending.indexOf("\n");
    }
  }
  pending += decoder.decode();
  if (pending.trim() !== "") yield v.parse(diffRowSchema, JSON.parse(pending));
}
