/**
 * The `Bun` global for the demo (#demo): the calls the API makes on its request paths, over the
 * in-memory disk. Passwords are kept as given: the demo's accounts guard nothing, and argon2 in a
 * page would take seconds a sign-in.
 */
import { encode } from "./crypto.ts";
import { hasher } from "./hash.ts";
import type { Incremental } from "./hash.ts";
import { bytesOf as textOrBytes, exists, list, put, read } from "./memfs.ts";

type Body = string | Uint8Array | ArrayBuffer | Blob | Response | DemoFile;
type Writer = {
  write: (chunk: string | Uint8Array) => number;
  flush: () => number;
  end: () => number;
};

class DemoFile {
  constructor(readonly name: string) {}

  get size(): number {
    return exists(this.name) ? read(this.name).length : 0;
  }

  async exists(): Promise<boolean> {
    return exists(this.name);
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return read(this.name).slice().buffer;
  }

  async text(): Promise<string> {
    return new TextDecoder().decode(read(this.name));
  }

  stream(): ReadableStream<Uint8Array> {
    const bytes = read(this.name);
    return new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
  }

  slice(start?: number, end?: number): Blob {
    return new Blob([read(this.name).slice(start, end)]);
  }

  /** Chunks gather in memory and land on the disk at `end`. */
  writer(): Writer {
    const parts: Uint8Array[] = [];
    let size = 0;
    return {
      write: (chunk) => {
        const bytes = textOrBytes(chunk);
        parts.push(bytes);
        size += bytes.length;
        return bytes.length;
      },
      flush: () => 0,
      end: () => {
        const joined = new Uint8Array(size);
        let at = 0;
        for (const part of parts) {
          joined.set(part, at);
          at += part.length;
        }
        put(this.name, joined);
        return size;
      },
    };
  }
}

async function bytesOf(body: Body): Promise<Uint8Array> {
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (body instanceof DemoFile) return read(body.name);
  if (body instanceof Blob || body instanceof Response)
    return new Uint8Array(await body.arrayBuffer());
  return textOrBytes(body);
}

class CryptoHasher {
  private readonly hash: Incremental;

  constructor(algorithm: string, key?: string | Uint8Array) {
    this.hash = hasher(algorithm, key);
  }

  update(data: string | Uint8Array | ArrayBuffer): this {
    this.hash.update(data instanceof ArrayBuffer ? new Uint8Array(data) : textOrBytes(data));
    return this;
  }

  digest(encoding?: "hex" | "base64"): string | Uint8Array {
    const bytes = this.hash.digest();
    return encoding === undefined ? bytes : encode(bytes, encoding);
  }
}

/** UUIDv7: 48 bits of milliseconds, then version, variant and random bits. */
function randomUUIDv7(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let ms = Date.now();
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = encode(bytes, "hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

class Glob {
  constructor(private readonly pattern: string) {}

  /** Only the `*.ext` shape the migration runner asks for. */
  scanSync(dir: string): string[] {
    const ext = this.pattern.replace(/^\*/, "");
    return list(dir).filter((name) => name.endsWith(ext));
  }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** FNV-1a over 64 bits: the API uses `Bun.hash` for stable row ids, never for security. */
function hash(input: string | Uint8Array): bigint {
  let value = 0xcbf29ce484222325n;
  for (const byte of textOrBytes(input))
    value = BigInt.asUintN(64, (value ^ BigInt(byte)) * 0x100000001b3n);
  return value;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function inflateSync(): never {
  throw new Error("Reading an XLSX file needs a real Testate server; the demo imports CSV");
}

async function write(path: string | DemoFile, body: Body): Promise<number> {
  const bytes = await bytesOf(body);
  put(path instanceof DemoFile ? path.name : path, bytes);
  return bytes.length;
}

export const demoBun = {
  randomUUIDv7,
  CryptoHasher,
  Glob,
  hash: Object.assign(hash, { crc32 }),
  sleep,
  inflateSync,
  write,
  file: (path: string): DemoFile => new DemoFile(path),
  password: {
    hash: async (plain: string): Promise<string> => `demo$${plain}`,
    verify: async (plain: string, stored: string): Promise<boolean> => stored === `demo$${plain}`,
  },
  env: {},
  argv: [],
};
