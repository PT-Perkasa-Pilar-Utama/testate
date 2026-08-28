import { mkdirSync, readdirSync, unlinkSync, statSync } from "node:fs";
import { join } from "node:path";

import type { WideEventRecord } from "./event.ts";

export type SinkOptions = {
  dir: string;
  retentionDays: number;
  stdout: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function serialize(record: WideEventRecord): string {
  const { sections, ...head } = record;
  return JSON.stringify({ ...head, ...sections });
}

/** Appends one JSON line per event to a daily file and mirrors it to stdout. */
export class FileSink {
  private currentDay = "";
  private writer: ReturnType<ReturnType<typeof Bun.file>["writer"]> | null = null;
  degraded = false;

  constructor(private readonly options: SinkOptions) {
    mkdirSync(options.dir, { recursive: true });
  }

  write(record: WideEventRecord): void {
    const line = serialize(record);
    if (this.options.stdout) console.log(line);
    try {
      this.rotate(record.ts.slice(0, 10));
      this.writer?.write(`${line}\n`);
      this.writer?.flush();
    } catch (cause: unknown) {
      this.degraded = true;
      if (!this.options.stdout) console.log(line);
      console.error(`log sink degraded: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  private rotate(day: string): void {
    if (day === this.currentDay && this.writer !== null) return;
    this.writer?.end();
    this.currentDay = day;
    this.writer = Bun.file(join(this.options.dir, `testate-${day}.jsonl`)).writer();
    this.sweep();
  }

  /** Deletes files older than the retention window. Returns the deleted file names. */
  sweep(now = Date.now()): string[] {
    const deleted: string[] = [];
    const cutoff = now - this.options.retentionDays * DAY_MS;
    for (const name of readdirSync(this.options.dir)) {
      const match = /^testate-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name);
      if (match === null) continue;
      const fileDay = Date.parse(`${match[1]}T00:00:00.000Z`);
      const path = join(this.options.dir, name);
      if (fileDay < cutoff && statSync(path).isFile()) {
        unlinkSync(path);
        deleted.push(name);
      }
    }
    return deleted;
  }

  close(): void {
    this.writer?.end();
    this.writer = null;
  }
}
