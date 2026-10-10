/**
 * An `elasticsearch` adapter's read (#92; E3–E5 of docs/decisions/2026-10-10-elasticsearch.md): its
 * connection, one page of the source's search on its time field, each document as an entry, masked
 * as every log is for viewers and agents (Q5).
 */
import { jsonObjectSchema } from "@testate/shared";
import type { Actor, EsSource, JsonObject, JsonValue, LogLevel, LogsQuery } from "@testate/shared";
import * as v from "valibot";

import { AppError } from "../../lib/http/index.ts";
import type { RawEntry } from "../../lib/logs/chunk.ts";
import type { EsHit } from "../../lib/logs/elasticsearch/parse.ts";
import { readEs } from "../../lib/logs/elasticsearch/read.ts";
import { levelOfText } from "../../lib/logs/fields.ts";
import { LINE_CAP } from "../../lib/logs/parse.ts";
import { passes } from "../../lib/logs/read.ts";
import type { EsResolver } from "../adapters/adapters.elasticsearch.api.ts";
import type { AdapterRecord } from "../adapters/adapters.repository.ts";
import { answerOf } from "./logs.service.ts";
import type { LogsAnswer } from "./logs.service.ts";

export type EsReader = (
  actor: Actor,
  adapter: AdapterRecord,
  query: LogsQuery
) => Promise<LogsAnswer>;

const LEVEL_FIELDS = ["log.level", "level", "severity"];

/** A field written dotted (`"log.level"`) or nested (`{"log":{"level"}}`), whichever is there (E3). */
export function fieldOf(source: JsonObject, path: string): JsonValue | undefined {
  if (path in source) return source[path];
  let node: JsonValue | undefined = source;
  for (const key of path.split(".")) {
    const parsed: v.SafeParseResult<typeof jsonObjectSchema> = v.safeParse(jsonObjectSchema, node);
    node = parsed.success ? parsed.output[key] : undefined;
  }
  return node;
}

function textOf(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "";
  const text = v.safeParse(v.string(), value);
  return text.success ? text.output : JSON.stringify(value);
}

function levelOf(source: JsonObject): LogLevel {
  for (const field of LEVEL_FIELDS) {
    const level = levelOfText(textOf(fieldOf(source, field)));
    if (level !== null) return level;
  }
  return "info";
}

/** The document's time is the hit's stamp; its message, level and the rest come from `_source`. */
function rawOf(hit: EsHit, source: EsSource): RawEntry {
  const { [source.message_field]: _message, ...fields } = hit.source;
  const message = textOf(fieldOf(hit.source, source.message_field));
  return {
    time: Number(hit.nanos / 1_000_000n),
    level: levelOf(hit.source),
    file: hit.index,
    message: message.length > LINE_CAP ? message.slice(0, LINE_CAP) : message,
    fields,
    offset: 0,
  };
}

function sourceOf(sources: EsSource[], name: string): EsSource {
  const source = sources.find((candidate) => candidate.name === name);
  if (source === undefined)
    throw new AppError("NOT_FOUND", "log source not found", {
      sources: sources.map((item) => item.name),
    });
  return source;
}

export function createEsReader(resolver: EsResolver): EsReader {
  return async (actor, adapter, query) => {
    const trustAs = actor.kind === "user" ? actor.id : null;
    const { config, api } = await resolver.resolve(adapter.project_id, adapter.id, trustAs);
    const source = sourceOf(config.sources, query.source);
    const read = await readEs(api, source, query);
    const entries = read.hits
      .map((hit) => rawOf(hit, source))
      .filter((entry) => passes(entry, query, false));
    return answerOf(
      { ...read, entries, untimed: false, filesOpened: 1, bytesRead: read.bytes },
      source,
      actor,
      adapter.name
    );
  };
}
