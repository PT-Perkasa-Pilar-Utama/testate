import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import { csvLine } from "./imports.csv.ts";
import type { Rejected } from "./imports.rowmap.ts";

const PREVIEW_ROWS = 100;

type Writer = ReturnType<ReturnType<typeof Bun.file>["writer"]>;

export type RejectedPreview = { row_number: number; reason: string };

export type RejectedSink = {
  /** The first {@link PREVIEW_ROWS} rejects, in the order they arrived; the run report carries these. */
  preview: RejectedPreview[];
  add: (item: Rejected) => void;
  /** Ends the file and returns its path, or null when the run rejected nothing. */
  close: () => Promise<string | null>;
  /** Ends and removes a half-written file so a failed run leaves nothing behind. */
  discard: () => Promise<void>;
};

export type RejectedSinkOptions = {
  dataDir: string;
  runId: string;
  columns: string[];
  fileBacked: boolean;
};

/**
 * Rejected rows stream to `imports/<run>/rejected.csv` as they arrive (19 §19.3), so a run that
 * rejects millions of rows never holds them in memory. A dry run keeps the preview only.
 */
export function createRejectedSink(options: RejectedSinkOptions): RejectedSink {
  const path = join(options.dataDir, "imports", options.runId, "rejected.csv");
  const preview: RejectedPreview[] = [];
  let writer: Writer | null = null;

  function open(): Writer {
    mkdirSync(dirname(path), { recursive: true });
    const opened = Bun.file(path).writer();
    opened.write(`${csvLine([...options.columns, "row_number", "reason"])}\n`);
    return opened;
  }

  async function end(): Promise<boolean> {
    if (writer === null) return false;
    await writer.end();
    writer = null;
    return true;
  }

  return {
    preview,
    add(item) {
      if (preview.length < PREVIEW_ROWS)
        preview.push({ row_number: item.row_number, reason: item.reason });
      if (!options.fileBacked) return;
      writer ??= open();
      writer.write(`${csvLine([...item.source, item.row_number, item.reason])}\n`);
    },
    async close() {
      return (await end()) ? path : null;
    },
    async discard() {
      if (await end()) rmSync(dirname(path), { recursive: true, force: true });
    },
  };
}
