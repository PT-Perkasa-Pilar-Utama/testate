/**
 * Where an `ingest` adapter's lines live (#75; Q4b, I2, I5, I9 of
 * docs/decisions/2026-10-10-logs-tier.md): `<root>/<adapter-id>/<source>/<YYYY-MM-DD>.jsonl`,
 * filed by the day they arrived (UTC), never in SQLite.
 */
import { appendFile, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import type { IngestAnswer } from "@testate/shared";

import { AppError } from "../../http/index.ts";
import type { LogFile, LogFiles } from "../read.ts";
import { dayFilesIn, ingestFiles, orNothing } from "./files.ts";
import { isSourceName, storedLine } from "./line.ts";
import type { StoredLine } from "./line.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const MB = 1024 * 1024;

export type IngestStore = {
  /** Stores a push body's lines; `INGEST_FULL` when today alone would pass the cap (I5). */
  write(adapterId: string, body: string, capMb: number): Promise<IngestAnswer>;
  /** Removes the day files older than `retentionDays`; returns how many went. */
  prune(adapterId: string, retentionDays: number): Promise<number>;
  /** Removes every line the adapter holds: "Clear logs", and a deleted adapter (I3a). */
  clear(adapterId: string): Promise<void>;
  /** The sources that hold at least one day file, by name. */
  sources(adapterId: string): Promise<string[]>;
  files(adapterId: string): LogFiles;
};

const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const dayOfFile = (file: LogFile): string => file.name.slice(0, 10);
const bytesOf = (files: LogFile[]): number => files.reduce((sum, file) => sum + file.size, 0);

/** Each source's lines as one block to append, one line each. */
function bySource(lines: StoredLine[]): Map<string, string> {
  const blocks = new Map<string, string>();
  for (const line of lines)
    blocks.set(line.source, `${blocks.get(line.source) ?? ""}${line.text}\n`);
  return blocks;
}

/** Adapter ids are UUIDs; the guard keeps a recursive delete inside `root` whatever is passed. */
const ADAPTER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function createIngestStore(root: string, now: () => Date): IngestStore {
  const base = (adapterId: string): string => {
    if (!ADAPTER_ID.test(adapterId)) throw new AppError("NOT_FOUND", "adapter not found");
    return join(root, adapterId);
  };
  const sourcesOf = async (adapterId: string): Promise<string[]> =>
    (await orNothing(readdir(base(adapterId)), [])).filter(isSourceName);
  const allFiles = async (adapterId: string): Promise<LogFile[]> => {
    const files: LogFile[] = [];
    for (const source of await sourcesOf(adapterId))
      files.push(...(await dayFilesIn(base(adapterId), source)));
    return files;
  };

  /**
   * Makes room for `adding` bytes: the oldest days go first, today never does.
   * ponytail: the cap is checked per push, not locked; two pushes at once can pass it by one body
   * (1 MB). A per-adapter queue is the upgrade if that ever matters.
   */
  const makeRoom = async (adapterId: string, adding: number, capMb: number): Promise<void> => {
    const today = dayOf(now().getTime());
    const files = await allFiles(adapterId);
    const cap = capMb * MB;
    if (bytesOf(files.filter((file) => dayOfFile(file) === today)) + adding > cap)
      throw new AppError("INGEST_FULL", "today's logs are over this adapter's size cap", {
        cap_mb: capMb,
      });
    let total = bytesOf(files);
    const older = files
      .filter((file) => dayOfFile(file) < today)
      .sort((a, b) => dayOfFile(a).localeCompare(dayOfFile(b)));
    for (const file of older) {
      if (total + adding <= cap) return;
      await rm(join(base(adapterId), file.path), { force: true });
      total -= file.size;
    }
  };

  return {
    async write(adapterId, body, capMb) {
      const at = now().getTime();
      const raw = body.split("\n").filter((line) => line.trim() !== "");
      if (raw.length === 0) throw new AppError("VALIDATION_ERROR", "the body holds no lines");
      const lines = raw.map((line) => storedLine(line.replace(/\r$/, ""), at));
      const blocks = bySource(lines);
      const adding = [...blocks.values()].reduce((sum, text) => sum + Buffer.byteLength(text), 0);
      await makeRoom(adapterId, adding, capMb);
      for (const [source, text] of blocks) {
        await mkdir(join(base(adapterId), source), { recursive: true });
        await appendFile(join(base(adapterId), source, `${dayOf(at)}.jsonl`), text);
      }
      return { accepted: lines.length, malformed: lines.filter((line) => line.malformed).length };
    },
    async prune(adapterId, retentionDays) {
      const cutoff = dayOf(now().getTime() - retentionDays * DAY_MS);
      const old = (await allFiles(adapterId)).filter((file) => dayOfFile(file) < cutoff);
      for (const file of old) await rm(join(base(adapterId), file.path), { force: true });
      return old.length;
    },
    async clear(adapterId) {
      await rm(base(adapterId), { recursive: true, force: true });
    },
    async sources(adapterId) {
      const held: string[] = [];
      for (const source of await sourcesOf(adapterId))
        if ((await dayFilesIn(base(adapterId), source)).length > 0) held.push(source);
      return held.sort();
    },
    files: (adapterId) => ingestFiles(base(adapterId)),
  };
}
