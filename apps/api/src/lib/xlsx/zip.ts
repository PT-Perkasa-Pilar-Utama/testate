/**
 * The ZIP subset OOXML needs (PKZIP APPNOTE 4.4): central directory lookup, stored and deflated
 * entries on the way in, stored entries on the way out. No zip64, no encryption, no data descriptors
 * on write. `Bun.inflateSync` and `Bun.hash.crc32` are the only primitives.
 */

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_RECORD = 0x06054b50;
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04] as const;

export type ZipEntry = { name: string; bytes: Uint8Array };

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** `PK\x03\x04` at offset 0: an OOXML workbook whatever the file name claims (reconflower's rule). */
export function isZip(bytes: Uint8Array): boolean {
  return ZIP_MAGIC.every((byte, index) => bytes[index] === byte);
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function findEndRecord(bytes: Uint8Array): number {
  const data = view(bytes);
  const floor = Math.max(0, bytes.byteLength - 65_557);
  for (let offset = bytes.byteLength - 22; offset >= floor; offset -= 1) {
    if (data.getUint32(offset, true) === END_RECORD) return offset;
  }
  throw new Error("zip: no end-of-central-directory record");
}

/** Every entry by name; the central directory is the source of truth for sizes and offsets. */
export function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const data = view(bytes);
  const end = findEndRecord(bytes);
  const count = data.getUint16(end + 10, true);
  let offset = data.getUint32(end + 16, true);
  const entries = new Map<string, Uint8Array>();
  for (let index = 0; index < count; index += 1) {
    if (data.getUint32(offset, true) !== CENTRAL_HEADER) throw new Error("zip: bad central header");
    const method = data.getUint16(offset + 10, true);
    const compressedSize = data.getUint32(offset + 20, true);
    const nameLength = data.getUint16(offset + 28, true);
    const extraLength = data.getUint16(offset + 30, true);
    const commentLength = data.getUint16(offset + 32, true);
    const localOffset = data.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (data.getUint32(localOffset, true) !== LOCAL_HEADER)
      throw new Error("zip: bad local header");
    const localNameLength = data.getUint16(localOffset + 26, true);
    const localExtraLength = data.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = bytes.subarray(start, start + compressedSize);
    if (method === 0) entries.set(name, raw);
    else if (method === 8) entries.set(name, Bun.inflateSync(raw.slice()));
    else throw new Error(`zip: unsupported method ${method} for ${name}`);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function u16(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff];
}

function u32(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff];
}

/** Stored entries only: OOXML readers accept them, and a sample workbook is tiny. */
export function writeZip(entries: ZipEntry[]): Uint8Array {
  const chunks: number[][] = [];
  const central: number[][] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = Bun.hash.crc32(entry.bytes);
    const header = [
      ...u32(LOCAL_HEADER),
      ...u16(20),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0x21),
      ...u32(crc),
      ...u32(entry.bytes.byteLength),
      ...u32(entry.bytes.byteLength),
      ...u16(name.byteLength),
      ...u16(0),
    ];
    chunks.push(header, [...name], [...entry.bytes]);
    central.push([
      ...u32(CENTRAL_HEADER),
      ...u16(20),
      ...u16(20),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0x21),
      ...u32(crc),
      ...u32(entry.bytes.byteLength),
      ...u32(entry.bytes.byteLength),
      ...u16(name.byteLength),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(offset),
      ...name,
    ]);
    offset += header.length + name.byteLength + entry.bytes.byteLength;
  }
  const centralStart = offset;
  const centralBytes = central.flat();
  const end = [
    ...u32(END_RECORD),
    ...u16(0),
    ...u16(0),
    ...u16(entries.length),
    ...u16(entries.length),
    ...u32(centralBytes.length),
    ...u32(centralStart),
    ...u16(0),
  ];
  return Uint8Array.from([...chunks.flat(), ...centralBytes, ...end]);
}
