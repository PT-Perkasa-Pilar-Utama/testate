import * as v from "valibot";
import type { Adapter, JsonObject, LokiConfig, LokiForm, LokiFormInput } from "@testate/shared";
import { lokiConfigSchema, lokiTenantSchema, lokiUrlSchema, patternLines } from "@testate/shared";

import { connectionOf } from "../adapters/adapters.fields.ts";
import type { Connection, EngineForm, Field, Values } from "../adapters/adapters.fields.ts";
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

const URL_FIELD: Field = {
  key: "url",
  label: "Address",
  type: "url",
  required: true,
  placeholder: "https://logs.example.com",
  hint: "Loki's base URL, with its path prefix if it has one.",
};
const TENANT_FIELD: Field = {
  key: "tenant",
  label: "Tenant",
  type: "text",
  hint: "Sent as X-Scope-OrgID, for a Loki that runs with several tenants.",
};

/** The login fields per auth (#90, L1). */
export const LOKI_FORMS = {
  none: { kind: "logs", label: "Loki", config: [URL_FIELD, TENANT_FIELD], secrets: [] },
  basic: {
    kind: "logs",
    label: "Loki with basic auth",
    config: [URL_FIELD, TENANT_FIELD, { key: "user", label: "User", type: "text", required: true }],
    secrets: [
      { key: "password", label: "Password or API token", type: "password", required: true },
    ],
  },
  bearer: {
    kind: "logs",
    label: "Loki with a token",
    config: [URL_FIELD, TENANT_FIELD],
    secrets: [{ key: "bearer_token", label: "Token", type: "password", required: true }],
  },
} as const satisfies Record<LokiForm["auth"], EngineForm>;

export const BLANK_LOKI_SOURCE = {
  name: "",
  query: "",
  format: "plain",
  regex: "",
  patterns: "",
} as const satisfies LokiFormInput["sources"][number];

export const BLANK_LOKI: LokiFormInput = {
  name: "",
  auth: "none",
  sources: [{ ...BLANK_LOKI_SOURCE }],
};

function sourceBody(source: LokiForm["sources"][number]): JsonObject {
  const body: JsonObject = {
    name: source.name.trim(),
    query: source.query,
    format: source.format,
    patterns: patternLines(source.patterns),
  };
  if (source.format === "regex") body.regex = source.regex;
  return body;
}

function configAndSecrets(input: LokiForm, values: Values): Connection {
  const { config, secrets } = connectionOf(LOKI_FORMS[input.auth], values);
  return {
    config: { ...config, auth: input.auth, sources: input.sources.map(sourceBody) },
    secrets,
  };
}

export function toLokiBody(input: LokiForm, values: Values): JsonObject {
  return logAdapterBody("loki", input.name, configAndSecrets(input, values));
}

export function toLokiPatch(input: LokiForm, values: Values): JsonObject {
  return logAdapterPatch(input.name, configAndSecrets(input, values));
}

function valuesOf(config: LokiConfig): Values {
  const values: Values = { "config.url": config.url };
  if (config.tenant !== undefined) values["config.tenant"] = config.tenant;
  if (config.user !== undefined) values["config.user"] = config.user;
  return values;
}

/** The dialog's seed for an adapter being edited: its sources, and its login as values. */
export function lokiDraftFrom(adapter: Adapter): ConnectionDraft<LokiFormInput> {
  const config = v.parse(lokiConfigSchema, adapter.config);
  const sources = config.sources.map((source) => ({
    name: source.name,
    query: source.query,
    format: source.format,
    regex: source.regex ?? "",
    patterns: source.patterns.join("\n"),
  }));
  return { input: { name: adapter.name, auth: config.auth, sources }, values: valuesOf(config) };
}

export type LokiFormPresenter = ConnectionFormPresenter<LokiFormInput, LokiForm>;

const LOKI_KIND: ConnectionKind<LokiFormInput, LokiForm> = {
  blank: BLANK_LOKI,
  draftFrom: lokiDraftFrom,
  toBody: toLokiBody,
  toPatch: toLokiPatch,
  formOf: (input) => LOKI_FORMS[input.auth],
  rules: [
    { key: "config.url", schema: lokiUrlSchema },
    { key: "config.tenant", schema: lokiTenantSchema },
  ],
};

export function createLokiFormPresenter(
  slug: () => string,
  onSaved: () => void
): LokiFormPresenter {
  return createConnectionFormPresenter(LOKI_KIND, slug, onSaved);
}
