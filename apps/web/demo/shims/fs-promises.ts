/** `node:fs/promises` for the demo, over the in-memory disk. */
import { bytesOf, exists, list, put, read, remove } from "./memfs.ts";

type Stat = { size: number; mtimeMs: number; isFile: () => boolean };

export async function appendFile(path: string, data: string | Uint8Array): Promise<void> {
  const before = exists(path) ? read(path) : new Uint8Array();
  const more = bytesOf(data);
  const joined = new Uint8Array(before.length + more.length);
  joined.set(before);
  joined.set(more, before.length);
  put(path, joined);
}
export const mkdir = async (): Promise<void> => undefined;
export const readdir = async (path: string): Promise<string[]> => list(path);
export const rm = async (path: string): Promise<void> => remove(path);
export async function stat(path: string): Promise<Stat> {
  const bytes = read(path);
  return { size: bytes.length, mtimeMs: Date.now(), isFile: () => true };
}
export default { appendFile, mkdir, readdir, rm, stat };
