/** `node:fs` for the demo, over the in-memory disk. Writers that log to files write nowhere. */
import { bytesOf, exists, list, put, read, remove } from "./memfs.ts";

const decoder = new TextDecoder();

type Stat = { size: number; isFile: () => boolean; isDirectory: () => boolean };
type StatFs = { bsize: number; blocks: number; bavail: number; bfree: number };

export const constants = { W_OK: 2, R_OK: 4 };
export const existsSync = (path: string): boolean => exists(path);
export const mkdirSync = (): void => undefined;
export const accessSync = (): void => undefined;
export const rmSync = (path: string): void => remove(path);
export const unlinkSync = (path: string): void => remove(path);
export const readdirSync = (path: string): string[] => list(path);
export const renameSync = (from: string, to: string): void => {
  put(to, read(from));
  remove(from);
};
export function readFileSync(path: string, encoding?: string): string | Uint8Array {
  const bytes = read(path);
  return encoding === undefined ? bytes : decoder.decode(bytes);
}
export function statSync(path: string): Stat {
  const size = exists(path) ? (files(path)?.length ?? null) : null;
  return { size: size ?? 0, isFile: () => size !== null, isDirectory: () => size === null };
}
function files(path: string): Uint8Array | null {
  try {
    return read(path);
  } catch {
    return null;
  }
}
export const statfsSync = (): StatFs => ({
  bsize: 4096,
  blocks: 2 ** 20,
  bavail: 2 ** 19,
  bfree: 2 ** 19,
});
export const openSync = (): number => 3;
export const writeSync = (_fd: number, data: string | Uint8Array): number => data.length;
export const closeSync = (): void => undefined;
export const copyFileSync = (from: string, to: string): void => put(to, read(from));
export const cpSync = (): void => undefined;
export const writeFileSync = (path: string, data: string | Uint8Array): void =>
  put(path, bytesOf(data));
