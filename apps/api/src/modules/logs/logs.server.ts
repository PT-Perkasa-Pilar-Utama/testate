/**
 * A database adapter's server logs, read through its own connection (#84; D2, D4, D7 of
 * docs/decisions/2026-10-10-db-server-logs.md). The engine returns a page of its source; level,
 * text and window apply here, after the read, and so does masking.
 */
import type { Actor, LogEntry, LogsQuery } from "@testate/shared";
import { LOG_LEVELS, jsonObjectSchema, serverLogSourceSchema } from "@testate/shared";
import * as v from "valibot";

import { toConnectionConfig } from "../../lib/engines/connection.ts";
import type { EngineRegistry, ServerLogEntry } from "../../lib/engines/index.ts";
import { AppError } from "../../lib/http/index.ts";
import { createMasker, maskEntry } from "../../lib/logs/mask.ts";
import {
  decodeServerCursor,
  encodeServerCursor,
  maskLiterals,
  withoutValues,
} from "../../lib/logs/server.ts";
import type { ServerKey } from "../../lib/logs/server.ts";
import type { KeyRing } from "../../lib/sealed/index.ts";
import type { AdapterRecord } from "../adapters/adapters.repository.ts";
import { CONFIG_COLUMN, openSecrets } from "../adapters/adapters.secrets.ts";
import { toAppError } from "../checkouts/checkouts.restore.ts";
import { masksApply } from "../data/data.masks.ts";
import type { LogsAnswer } from "./logs.service.ts";

export type ServerLogDeps = { engines: Pick<EngineRegistry, "require">; ring: KeyRing };

/** The sources the probe found this credential can read (D3); none before a probe ran. */
export const readableOf = (adapter: AdapterRecord): string[] =>
  adapter.capabilities?.serverLogs ?? [];

const rank = (level: string): number => LOG_LEVELS.findIndex((item) => item === level);

/** The read query's filters, on one entry. */
function passes(entry: ServerLogEntry, query: LogsQuery): boolean {
  if (query.level !== undefined && rank(entry.level) < rank(query.level)) return false;
  const time = entry.key.time;
  if (query.from !== undefined && time < Date.parse(query.from)) return false;
  if (query.to !== undefined && time > Date.parse(query.to)) return false;
  const text = (query.text ?? "").toLowerCase();
  return (
    text === "" || `${entry.message} ${JSON.stringify(entry.fields)}`.toLowerCase().includes(text)
  );
}

/**
 * A statement is the data (D7): a masked reader sees the engine's digest, or the statement with
 * its literals taken out, and fields with their values hidden; the built-in secret patterns apply
 * on top. Testers and admins see it raw.
 */
function shown(entry: ServerLogEntry, masked: boolean): LogEntry {
  const time = new Date(entry.key.time).toISOString();
  const base = { time, level: entry.level, file: "" };
  if (!masked) return { ...base, message: entry.message, fields: entry.fields, masked: false };
  const fields =
    entry.fields === null ? null : v.parse(jsonObjectSchema, withoutValues(entry.fields));
  const hidden = maskEntry(entry.digest ?? maskLiterals(entry.message), fields, createMasker([]));
  return { ...base, ...hidden, masked: true };
}

const cursorOf = (raw: string | undefined): ServerKey | null =>
  raw === undefined ? null : decodeServerCursor(raw).before;
const afterOf = (raw: string | undefined): ServerKey | null =>
  raw === undefined ? null : decodeServerCursor(raw).after;

export type ServerLogReader = (
  actor: Actor,
  adapter: AdapterRecord,
  query: LogsQuery
) => Promise<LogsAnswer>;

export function createServerLogReader(deps: ServerLogDeps): ServerLogReader {
  return async (actor: Actor, adapter: AdapterRecord, query: LogsQuery): Promise<LogsAnswer> => {
    const readable = readableOf(adapter);
    const source = v.safeParse(serverLogSourceSchema, query.source);
    if (!source.success || !readable.includes(source.output))
      throw new AppError("NOT_FOUND", "log source not found", { sources: readable });
    const secrets = await openSecrets(deps.ring, adapter.id, CONFIG_COLUMN, adapter.config_sealed);
    const conn = {
      connectionId: adapter.id,
      config: toConnectionConfig(adapter.engine, adapter.config, secrets),
    };
    const before = cursorOf(query.cursor);
    const after = afterOf(query.after);
    const read = await deps.engines
      .require(adapter.engine)
      .readServerLog(conn, source.output, { limit: query.limit, before, after })
      .catch((cause: unknown) => {
        throw toAppError(cause, adapter.id);
      });
    const last = read.entries.at(-1);
    const newest = read.entries[0]?.key ?? after;
    const entries = read.entries
      .filter((entry) => passes(entry, query))
      .map((entry) => shown(entry, masksApply(actor)));
    // A database source is a bounded window: once it is read to its end, older lines are outside it.
    const cutBy = read.end ? "window" : "lines";
    return {
      page: {
        entries,
        cursor:
          read.end || last === undefined
            ? null
            : encodeServerCursor({ before: last.key, after: null }),
        after: encodeServerCursor({ before: null, after: newest }),
        cut_by: entries.length === 0 && read.end ? null : cutBy,
        untimed: false,
      },
      adapterName: adapter.name,
      stats: { source: source.output, files: 0, bytes: 0, entries: entries.length, cutBy },
    };
  };
}
