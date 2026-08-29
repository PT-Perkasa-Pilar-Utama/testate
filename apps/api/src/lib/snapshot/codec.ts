import type { JsonValue } from "@testate/shared";
import { jsonValueSchema } from "@testate/shared";
import * as v from "valibot";

import { rowText } from "../engines/types.ts";
import type { EncodedRow, SortKey } from "../engines/types.ts";

/**
 * Line format inside a blob (15 §15.2): `{"k":<sort key>,"r":<RowText>}` per row, gzip level 6 with a
 * zero mtime header, so identical data gives identical bytes and dedup works.
 */
export function encodeLine(row: EncodedRow): string {
  return `{"k":${JSON.stringify(row.key.value)},"r":${row.json}}\n`;
}

export function encodeChunks(rows: AsyncIterable<EncodedRow>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const lines = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next();
      if (next.done) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(encodeLine(next.value)));
    },
    async cancel() {
      await iterator.return?.();
    },
  });
  const iterator = rows[Symbol.asyncIterator]();
  // SAFETY: CompressionStream transforms bytes to bytes; Bun types narrow the array buffer flavour only.
  return lines.pipeThrough(
    new CompressionStream("gzip") as TransformStream<Uint8Array, Uint8Array>
  );
}

const keySchema = v.union([v.string(), v.array(jsonValueSchema)]);

function sortKeyOf(value: JsonValue): SortKey {
  const parsed = v.parse(keySchema, value);
  return Array.isArray(parsed)
    ? { by: "primary-key", value: parsed }
    : { by: "row-hash", value: parsed };
}

/** Splits one line back into its sort key and the verbatim row text (never re-serialized). */
export function decodeLine(line: string): EncodedRow {
  const keyStart = line.indexOf('"k":');
  const rowStart = line.indexOf(',"r":', keyStart);
  if (!line.startsWith("{") || keyStart !== 1 || rowStart === -1 || !line.endsWith("}")) {
    throw new Error("malformed snapshot line");
  }
  const key = sortKeyOf(v.parse(jsonValueSchema, JSON.parse(line.slice(keyStart + 4, rowStart))));
  return { key, json: rowText(line.slice(rowStart + 5, -1)) };
}

export async function* decodeChunks(stream: ReadableStream<Uint8Array>): AsyncIterable<EncodedRow> {
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
      yield decodeLine(pending.slice(0, newline));
      pending = pending.slice(newline + 1);
      newline = pending.indexOf("\n");
    }
  }
  pending += decoder.decode();
  if (pending.trim() !== "") yield decodeLine(pending.trim());
}
