/**
 * PAX tar (15 §15.5): every entry carries a `path` and `size` extended header, so names over 100
 * characters and files over 8 GiB round-trip. Written as a stream; read from bytes.
 */

const BLOCK = 512;

export type TarEntry = { name: string; body: ReadableStream<Uint8Array>; size: number };

function octal(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, "0")}\0`;
}

function header(name: string, size: number, type: "0" | "x"): Uint8Array {
  const block = new Uint8Array(BLOCK);
  const encoder = new TextEncoder();
  const put = (offset: number, text: string): void => {
    block.set(encoder.encode(text), offset);
  };
  put(0, name.slice(0, 100));
  put(100, octal(0o644, 8));
  put(108, octal(0, 8));
  put(116, octal(0, 8));
  put(124, octal(size, 12));
  put(136, octal(0, 12));
  put(148, "        ");
  put(156, type);
  put(257, "ustar\0");
  put(263, "00");
  let sum = 0;
  for (const byte of block) sum += byte;
  put(148, `${sum.toString(8).padStart(6, "0")}\0 `);
  return block;
}

function padding(size: number): Uint8Array {
  const rest = size % BLOCK;
  return new Uint8Array(rest === 0 ? 0 : BLOCK - rest);
}

/** `<len> key=value\n` records, `len` counting itself (POSIX.1-2001 pax). */
function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`;
  let length = body.length + 1;
  while (String(length).length + body.length !== length)
    length = String(length).length + body.length;
  return `${length}${body}`;
}

/** One entry per call; the caller closes with `tarEnd`. */
export function tarEntry(entry: TarEntry): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const pax = encoder.encode(paxRecord("path", entry.name) + paxRecord("size", String(entry.size)));
  const reader = entry.body.getReader();
  const prelude = [
    header("./PaxHeaders/entry", pax.length, "x"),
    pax,
    padding(pax.length),
    header(entry.name, entry.size, "0"),
  ];
  let index = 0;
  let written = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index < prelude.length) {
        controller.enqueue(prelude[index] ?? new Uint8Array());
        index += 1;
        return;
      }
      const { done, value } = await reader.read();
      if (!done && value !== undefined) {
        written += value.byteLength;
        controller.enqueue(value);
        return;
      }
      if (written !== entry.size)
        throw new Error(`tar entry ${entry.name}: expected ${entry.size} bytes, wrote ${written}`);
      controller.enqueue(padding(entry.size));
      controller.close();
    },
  });
}

export function tarEnd(): Uint8Array {
  return new Uint8Array(BLOCK * 2);
}

async function* tarBytes(entries: AsyncIterable<TarEntry>): AsyncIterable<Uint8Array> {
  for await (const entry of entries) {
    for await (const chunk of tarEntry(entry)) yield chunk;
  }
  yield tarEnd();
}

/** Concatenates entry streams and the end-of-archive blocks into one stream. */
export function writeTar(entries: AsyncIterable<TarEntry>): ReadableStream<Uint8Array> {
  const iterator = tarBytes(entries)[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
  });
}

export type ReadEntry = { name: string; bytes: Uint8Array };

function parseHeader(block: Uint8Array): { name: string; size: number; type: string } | null {
  if (block.every((byte) => byte === 0)) return null;
  const text = (start: number, length: number): string =>
    new TextDecoder().decode(block.subarray(start, start + length)).replace(/\0.*$/s, "");
  return {
    name: text(0, 100),
    size: Number.parseInt(text(124, 12).trim() || "0", 8),
    type: text(156, 1) || "0",
  };
}

function parsePax(bytes: Uint8Array): Map<string, string> {
  const records = new Map<string, string>();
  const text = new TextDecoder().decode(bytes);
  let cursor = 0;
  while (cursor < text.length) {
    const space = text.indexOf(" ", cursor);
    if (space === -1) break;
    const length = Number(text.slice(cursor, space));
    const record = text.slice(space + 1, cursor + length - 1);
    const equals = record.indexOf("=");
    if (equals !== -1) records.set(record.slice(0, equals), record.slice(equals + 1));
    cursor += length;
  }
  return records;
}

/** Entries in order; pax `path` and `size` override the ustar fields when present. */
export function* readTar(bytes: Uint8Array): Generator<ReadEntry> {
  let offset = 0;
  let pax = new Map<string, string>();
  while (offset + BLOCK <= bytes.byteLength) {
    const head = parseHeader(bytes.subarray(offset, offset + BLOCK));
    offset += BLOCK;
    if (head === null) return;
    const size = Number(pax.get("size") ?? head.size);
    const body = bytes.subarray(offset, offset + size);
    offset += size + padding(size).byteLength;
    if (head.type === "x") {
      pax = parsePax(body);
      continue;
    }
    const name = pax.get("path") ?? head.name;
    pax = new Map();
    yield { name, bytes: body };
  }
}
