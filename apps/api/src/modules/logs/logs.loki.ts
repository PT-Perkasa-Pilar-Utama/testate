/**
 * A `loki` adapter's read (#90; L4–L6 of docs/decisions/2026-10-10-loki.md): its connection, one
 * page of the source's query on Loki's stamp, each line parsed by the source's format and masked as
 * every log is for viewers and agents (Q5).
 */
import type { Actor, JsonObject, LogLevel, LogsQuery, LokiSource } from "@testate/shared";
import * as v from "valibot";

import { AppError } from "../../lib/http/index.ts";
import type { RawEntry } from "../../lib/logs/chunk.ts";
import { levelOfText } from "../../lib/logs/fields.ts";
import type { LokiLine } from "../../lib/logs/loki/parse.ts";
import { readLoki } from "../../lib/logs/loki/read.ts";
import { parserFor } from "../../lib/logs/parse.ts";
import type { LineParser } from "../../lib/logs/parse.ts";
import { passes } from "../../lib/logs/read.ts";
import type { LokiResolver } from "../adapters/adapters.loki.api.ts";
import type { AdapterRecord } from "../adapters/adapters.repository.ts";
import { answerOf } from "./logs.service.ts";
import type { LogsAnswer } from "./logs.service.ts";

export type LokiReader = (
  actor: Actor,
  adapter: AdapterRecord,
  query: LogsQuery
) => Promise<LogsAnswer>;

const LEVEL_LABELS = ["level", "detected_level", "severity"];

/** The first level label Loki carries, when it names a level. */
function labelLevel(labels: JsonObject): LogLevel | null {
  for (const key of LEVEL_LABELS) {
    const text = v.safeParse(v.string(), labels[key]);
    const level = text.success ? levelOfText(text.output) : null;
    if (level !== null) return level;
  }
  return null;
}

/** Loki's stamp is the time; the format gives the level, message and fields (L4). */
function rawOf(line: LokiLine, parse: LineParser): RawEntry {
  const parsed = parse(line.text);
  const file = v.safeParse(v.string(), line.labels["service_name"] ?? line.labels["job"]);
  return {
    time: Number(line.nanos / 1_000_000n),
    level: parsed.level ?? labelLevel(line.labels) ?? "info",
    file: file.success ? file.output : "",
    message: parsed.message,
    fields: { ...line.labels, ...parsed.fields },
    offset: 0,
  };
}

function sourceOf(sources: LokiSource[], name: string): LokiSource {
  const source = sources.find((candidate) => candidate.name === name);
  if (source === undefined)
    throw new AppError("NOT_FOUND", "log source not found", {
      sources: sources.map((item) => item.name),
    });
  return source;
}

export function createLokiReader(lokis: LokiResolver, clock: () => number = Date.now): LokiReader {
  return async (actor, adapter, query) => {
    const trustAs = actor.kind === "user" ? actor.id : null;
    const { config, api } = await lokis.resolve(adapter.project_id, adapter.id, trustAs);
    const source = sourceOf(config.sources, query.source);
    const read = await readLoki(api, source, query, clock);
    const parse = parserFor(source);
    const entries = read.lines
      .map((line) => rawOf(line, parse))
      .filter((entry) => passes(entry, query, false));
    return answerOf(
      { ...read, entries, untimed: false, filesOpened: 1, bytesRead: read.bytes },
      source,
      actor,
      adapter.name
    );
  };
}
