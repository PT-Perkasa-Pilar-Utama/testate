import * as v from "valibot";
import type { Adapter, JournaldForm, JournaldFormInput, JsonObject } from "@testate/shared";
import { journaldConfigSchema, patternLines, unitWords } from "@testate/shared";

import { connectionOf } from "../adapters/adapters.fields.ts";
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

/** A source with no units reads the whole journal (J3 of docs/decisions/2026-10-10-journald.md). */
export const BLANK_JOURNAL_SOURCE = {
  name: "",
  units: "",
  patterns: "",
} as const satisfies JournaldFormInput["sources"][number];

export const BLANK_JOURNALD: JournaldFormInput = {
  name: "",
  sources: [{ ...BLANK_JOURNAL_SOURCE }],
};

function configAndSecrets(input: JournaldForm, values: Values): Connection {
  const { config, secrets } = connectionOf("journald", values);
  const sources = input.sources.map((source) => ({
    name: source.name.trim(),
    units: unitWords(source.units),
    patterns: patternLines(source.patterns),
  }));
  return { config: { ...config, sources }, secrets };
}

export function toJournaldBody(input: JournaldForm, values: Values): JsonObject {
  return logAdapterBody("journald", input.name, configAndSecrets(input, values));
}

export function toJournaldPatch(input: JournaldForm, values: Values): JsonObject {
  return logAdapterPatch(input.name, configAndSecrets(input, values));
}

/** The dialog's seed for an adapter being edited: its sources, and its login as values. */
export function journaldDraftFrom(adapter: Adapter): ConnectionDraft<JournaldFormInput> {
  const config = v.parse(journaldConfigSchema, adapter.config);
  const values: Values = { "config.host": config.host, "config.user": config.user };
  if (config.port !== undefined) values["config.port"] = String(config.port);
  const sources = config.sources.map((source) => ({
    name: source.name,
    units: source.units.join(" "),
    patterns: source.patterns.join("\n"),
  }));
  return { input: { name: adapter.name, sources }, values };
}

export type JournaldFormPresenter = ConnectionFormPresenter<JournaldFormInput, JournaldForm>;

const JOURNALD_KIND: ConnectionKind<JournaldFormInput, JournaldForm> = {
  blank: BLANK_JOURNALD,
  draftFrom: journaldDraftFrom,
  toBody: toJournaldBody,
  toPatch: toJournaldPatch,
  engineOf: () => "journald",
};

export function createJournaldFormPresenter(
  slug: () => string,
  onSaved: () => void
): JournaldFormPresenter {
  return createConnectionFormPresenter(JOURNALD_KIND, slug, onSaved);
}
