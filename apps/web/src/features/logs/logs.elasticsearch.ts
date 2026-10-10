import * as v from "valibot";
import type { Adapter, EsConfig, EsForm, EsFormInput, JsonObject } from "@testate/shared";
import { esConfigSchema, esUrlSchema, patternLines } from "@testate/shared";

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
  placeholder: "https://es.example.com:9200",
  hint: "The cluster's Elasticsearch URL; on Elastic Cloud, the deployment's Elasticsearch endpoint.",
};

/** The login fields per auth (#92, E1). */
export const ES_FORMS = {
  none: { kind: "logs", label: "Elasticsearch", config: [URL_FIELD], secrets: [] },
  basic: {
    kind: "logs",
    label: "Elasticsearch with a user",
    config: [URL_FIELD, { key: "user", label: "User", type: "text", required: true }],
    secrets: [{ key: "password", label: "Password", type: "password", required: true }],
  },
  api_key: {
    kind: "logs",
    label: "Elasticsearch with an API key",
    config: [URL_FIELD],
    secrets: [
      {
        key: "api_key",
        label: "API key",
        type: "password",
        required: true,
        hint: "The encoded key Kibana shows when the key is made.",
      },
    ],
  },
  bearer: {
    kind: "logs",
    label: "Elasticsearch with a token",
    config: [URL_FIELD],
    secrets: [{ key: "bearer_token", label: "Token", type: "password", required: true }],
  },
} as const satisfies Record<EsForm["auth"], EngineForm>;

export const BLANK_ES_SOURCE = {
  name: "",
  index: "",
  query: "",
  time_field: "@timestamp",
  message_field: "message",
  patterns: "",
} as const satisfies EsFormInput["sources"][number];

export const BLANK_ES: EsFormInput = {
  name: "",
  auth: "none",
  tls_ca: "",
  sources: [{ ...BLANK_ES_SOURCE }],
};

function sourceBody(source: EsForm["sources"][number]): JsonObject {
  return {
    name: source.name.trim(),
    index: source.index,
    query: source.query,
    time_field: source.time_field,
    message_field: source.message_field,
    patterns: patternLines(source.patterns),
  };
}

function configAndSecrets(input: EsForm, values: Values): Connection {
  const { config, secrets } = connectionOf(ES_FORMS[input.auth], values);
  const body: JsonObject = { ...config, auth: input.auth, sources: input.sources.map(sourceBody) };
  if (input.tls_ca !== "") body.tls_ca = input.tls_ca;
  return { config: body, secrets };
}

export function toEsBody(input: EsForm, values: Values): JsonObject {
  return logAdapterBody("elasticsearch", input.name, configAndSecrets(input, values));
}

export function toEsPatch(input: EsForm, values: Values): JsonObject {
  return logAdapterPatch(input.name, configAndSecrets(input, values));
}

function valuesOf(config: EsConfig): Values {
  const values: Values = { "config.url": config.url };
  if (config.user !== undefined) values["config.user"] = config.user;
  return values;
}

/** The dialog's seed for an adapter being edited: its sources and CA, and its login as values. */
export function esDraftFrom(adapter: Adapter): ConnectionDraft<EsFormInput> {
  const config = v.parse(esConfigSchema, adapter.config);
  const sources = config.sources.map((source) => ({
    name: source.name,
    index: source.index,
    query: source.query,
    time_field: source.time_field,
    message_field: source.message_field,
    patterns: source.patterns.join("\n"),
  }));
  return {
    input: { name: adapter.name, auth: config.auth, tls_ca: config.tls_ca ?? "", sources },
    values: valuesOf(config),
  };
}

export type EsFormPresenter = ConnectionFormPresenter<EsFormInput, EsForm>;

const ES_KIND: ConnectionKind<EsFormInput, EsForm> = {
  blank: BLANK_ES,
  draftFrom: esDraftFrom,
  toBody: toEsBody,
  toPatch: toEsPatch,
  formOf: (input) => ES_FORMS[input.auth],
  rules: [{ key: "config.url", schema: esUrlSchema }],
};

export function createEsFormPresenter(slug: () => string, onSaved: () => void): EsFormPresenter {
  return createConnectionFormPresenter(ES_KIND, slug, onSaved);
}
