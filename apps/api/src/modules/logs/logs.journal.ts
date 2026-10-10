/**
 * A `journald` adapter's read (#86; J1–J6 of docs/decisions/2026-10-10-journald.md): its shell,
 * one `journalctl` page, masked as every log is for viewers and agents (Q5).
 */
import type { Actor, LogEntry, LogsQuery } from "@testate/shared";

import { AppError } from "../../lib/http/index.ts";
import { readJournal } from "../../lib/logs/journald/read.ts";
import { createMasker, maskEntry } from "../../lib/logs/mask.ts";
import type { AdapterRecord } from "../adapters/adapters.repository.ts";
import type { ShellResolver } from "../adapters/adapters.shell.ts";
import { masksApply } from "../data/data.masks.ts";
import type { LogsAnswer } from "./logs.service.ts";

export type JournalReader = (
  actor: Actor,
  adapter: AdapterRecord,
  query: LogsQuery
) => Promise<LogsAnswer>;

export function createJournalReader(shells: ShellResolver): JournalReader {
  return async (actor, adapter, query) => {
    const trustAs = actor.kind === "user" ? actor.id : null;
    const { config, shell } = await shells.resolve(adapter.project_id, adapter.id, trustAs);
    try {
      const source = config.sources.find((candidate) => candidate.name === query.source);
      if (source === undefined)
        throw new AppError("NOT_FOUND", "log source not found", {
          sources: config.sources.map((item) => item.name),
        });
      const read = await readJournal(shell, source, query);
      const masker = masksApply(actor) ? createMasker(source.patterns) : null;
      const entries = read.entries.map((entry): LogEntry => {
        const base = {
          time: new Date(entry.time).toISOString(),
          level: entry.level,
          file: String(entry.fields["unit"] ?? ""),
        };
        if (masker === null)
          return { ...base, message: entry.message, fields: entry.fields, masked: false };
        return { ...base, ...maskEntry(entry.message, entry.fields, masker) };
      });
      return {
        page: {
          entries,
          cursor: read.cursor,
          after: read.after,
          cut_by: read.cutBy,
          untimed: false,
        },
        adapterName: adapter.name,
        stats: {
          source: source.name,
          files: 0,
          bytes: read.bytes,
          entries: entries.length,
          cutBy: read.cutBy,
        },
      };
    } finally {
      await shell.close();
    }
  };
}
