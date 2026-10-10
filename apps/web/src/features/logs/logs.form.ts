import * as v from "valibot";
import type {
  Adapter,
  JsonObject,
  LogfileConfig,
  LogfileForm,
  LogfileFormInput,
  LogSource,
} from "@testate/shared";
import { logfileConfigSchema, patternLines } from "@testate/shared";

import { ENGINE_FORMS, connectionOf } from "../adapters/adapters.fields.ts";
import type { Connection, Values } from "../adapters/adapters.fields.ts";
import {
  createConnectionFormPresenter,
  logAdapterBody,
  logAdapterPatch,
} from "./logs.connection.ts";
import type {
  ConnectionDraft,
  ConnectionFormPresenter,
  ConnectionKind,
} from "./logs.connection.ts";

/** A source as the dialog first shows it: pm2's out and error files, the common case (#69). */
export const BLANK_SOURCE = {
  name: "",
  glob: "",
  format: "pm2",
  regex: "",
  patterns: "",
} as const satisfies LogfileFormInput["sources"][number];

export const BLANK_LOGFILE: LogfileFormInput = {
  name: "",
  transport: "sftp",
  sources: [{ ...BLANK_SOURCE }],
};

function sourceBody(source: LogfileForm["sources"][number]): JsonObject {
  const body: JsonObject = {
    name: source.name.trim(),
    glob: source.glob.trim(),
    format: source.format,
    patterns: patternLines(source.patterns),
  };
  if (source.format === "regex") body.regex = source.regex;
  return body;
}

/** The connection's fields from `values` as the transport's storage engine, plus the sources. */
function configAndSecrets(input: LogfileForm, values: Values): Connection {
  const { config, secrets } = connectionOf(input.transport, values);
  return {
    config: { ...config, transport: input.transport, sources: input.sources.map(sourceBody) },
    secrets,
  };
}

export function toLogfileBody(input: LogfileForm, values: Values): JsonObject {
  return logAdapterBody("logfile", input.name, configAndSecrets(input, values));
}

export function toLogfilePatch(input: LogfileForm, values: Values): JsonObject {
  return logAdapterPatch(input.name, configAndSecrets(input, values));
}

function formSource(source: LogSource): LogfileFormInput["sources"][number] {
  return {
    name: source.name,
    glob: source.glob,
    format: source.format,
    regex: source.regex ?? "",
    patterns: source.patterns.join("\n"),
  };
}

const scalarSchema = v.union([v.string(), v.number(), v.boolean()]);

/** A stored connection field as the text box shows it; null when it is not set. */
function asText(config: LogfileConfig, key: string): string | null {
  const parsed = v.safeParse(scalarSchema, new Map(Object.entries(config)).get(key));
  return parsed.success ? String(parsed.output) : null;
}

export type LogfileDraft = ConnectionDraft<LogfileFormInput>;

/** The dialog\'s seed for an adapter being edited: its fields, and its connection as values. */
export function logfileDraftFrom(adapter: Adapter): LogfileDraft {
  const config = v.parse(logfileConfigSchema, adapter.config);
  const values: Values = {};
  for (const field of ENGINE_FORMS[config.transport].config) {
    const text = asText(config, field.key);
    if (text !== null) values[`config.${field.key}`] = text;
  }
  return {
    input: {
      name: adapter.name,
      transport: config.transport,
      sources: config.sources.map(formSource),
    },
    values,
  };
}

export type LogfileFormPresenter = ConnectionFormPresenter<LogfileFormInput, LogfileForm>;

/** What makes the generic connection dialog a logfile one. */
export const LOGFILE_KIND: ConnectionKind<LogfileFormInput, LogfileForm> = {
  blank: BLANK_LOGFILE,
  draftFrom: logfileDraftFrom,
  toBody: toLogfileBody,
  toPatch: toLogfilePatch,
  engineOf: (input) => input.transport,
};

export function createLogfileFormPresenter(
  slug: () => string,
  onSaved: () => void
): LogfileFormPresenter {
  return createConnectionFormPresenter(LOGFILE_KIND, slug, onSaved);
}
