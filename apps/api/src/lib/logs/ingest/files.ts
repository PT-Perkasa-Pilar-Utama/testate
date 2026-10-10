/**
 * An `ingest` adapter's stored lines as `LogFiles`, so the reader that serves `logfile` serves
 * these too (I2). `dir` is a source name and `path` is `<source>/<day>.jsonl`; anything else
 * reads as nothing, so a source taken from a URL can never leave the adapter's folder.
 */
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import * as v from "valibot";

import type { LogFile, LogFiles } from "../read.ts";
import { isSourceName } from "./line.ts";

export const DAY_FILE = /^\d{4}-\d{2}-\d{2}\.jsonl$/;

const missingSchema = v.object({ code: v.literal("ENOENT") });

/** A folder or file that is not there yet holds no lines; any other failure is real. */
export async function orNothing<T>(read: Promise<T>, nothing: T): Promise<T> {
  try {
    return await read;
  } catch (cause: unknown) {
    if (v.is(missingSchema, cause)) return nothing;
    throw cause;
  }
}

/** The day files in one source folder, with their size and modified time. */
export async function dayFilesIn(base: string, source: string): Promise<LogFile[]> {
  if (!isSourceName(source)) return [];
  const names = await orNothing(readdir(join(base, source)), []);
  const files: LogFile[] = [];
  for (const name of names.filter((candidate) => DAY_FILE.test(candidate))) {
    const info = await orNothing(stat(join(base, source, name)), null);
    if (info === null || !info.isFile()) continue;
    files.push({ name, path: `${source}/${name}`, size: info.size, modified: info.mtimeMs });
  }
  return files;
}

export function ingestFiles(base: string): LogFiles {
  return {
    list: (dir) => dayFilesIn(base, dir),
    async readRange(path, start, end) {
      const [source = "", name = "", ...rest] = path.split("/");
      if (rest.length > 0 || !isSourceName(source) || !DAY_FILE.test(name)) return new Uint8Array();
      const read = Bun.file(join(base, source, name))
        .slice(start, end)
        .arrayBuffer();
      return new Uint8Array(await orNothing(read, new ArrayBuffer(0)));
    },
  };
}
