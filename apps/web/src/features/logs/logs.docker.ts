import * as v from "valibot";
import type {
  Adapter,
  DockerConfig,
  DockerForm,
  DockerFormInput,
  JsonObject,
} from "@testate/shared";
import { dockerConfigSchema, dockerSocketSchema, patternLines } from "@testate/shared";

import { HOST_PORT, connectionOf } from "../adapters/adapters.fields.ts";
import type { Connection, EngineForm, Values } from "../adapters/adapters.fields.ts";
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

/**
 * The login fields per transport (#88, K1). A client certificate over TCP goes through the API: a
 * PEM block does not fit a one-line box.
 */
export const DOCKER_FORMS = {
  ssh: {
    kind: "logs",
    label: "Docker over SSH",
    config: [
      ...HOST_PORT(22),
      { key: "user", label: "User", type: "text", required: true },
      { key: "socket_path", label: "Socket", type: "text", placeholder: "/var/run/docker.sock" },
    ],
    secrets: [{ key: "password", label: "Password", type: "password", required: true }],
  },
  tcp: {
    kind: "logs",
    label: "Docker over TCP",
    config: [
      ...HOST_PORT(2376),
      {
        key: "http",
        label: "Plain http, for a socket proxy on a private network",
        type: "boolean",
      },
    ],
    secrets: [],
  },
} as const satisfies Record<DockerForm["transport"], EngineForm>;

export const BLANK_DOCKER_SOURCE = {
  name: "",
  container: "",
  format: "plain",
  regex: "",
  patterns: "",
} as const satisfies DockerFormInput["sources"][number];

export const BLANK_DOCKER: DockerFormInput = {
  name: "",
  transport: "ssh",
  sources: [{ ...BLANK_DOCKER_SOURCE }],
};

function sourceBody(source: DockerForm["sources"][number]): JsonObject {
  const body: JsonObject = {
    name: source.name.trim(),
    container: source.container.trim(),
    format: source.format,
    patterns: patternLines(source.patterns),
  };
  if (source.format === "regex") body.regex = source.regex;
  return body;
}

/** Set through the API and kept by an edit: the dialog carries them as values it never shows. */
const KEPT = ["tls_cert", "tls_ca"] as const;

function kept(values: Values): JsonObject {
  const config: JsonObject = {};
  for (const key of KEPT) {
    const value = values[`config.${key}`];
    if (value !== undefined) config[key] = value;
  }
  return config;
}

/** The switch stands for the scheme: on is `http`, off `https` (K1). */
function configAndSecrets(input: DockerForm, values: Values): Connection {
  const { config, secrets } = connectionOf(DOCKER_FORMS[input.transport], values);
  const { http, ...rest } = config;
  const tcp =
    input.transport === "tcp" ? { scheme: http === true ? "http" : "https", ...kept(values) } : {};
  const sources = input.sources.map(sourceBody);
  return { config: { ...rest, ...tcp, transport: input.transport, sources }, secrets };
}

export function toDockerBody(input: DockerForm, values: Values): JsonObject {
  return logAdapterBody("docker", input.name, configAndSecrets(input, values));
}

export function toDockerPatch(input: DockerForm, values: Values): JsonObject {
  return logAdapterPatch(input.name, configAndSecrets(input, values));
}

function valuesOf(config: DockerConfig): Values {
  const values: Values = { "config.host": config.host };
  if (config.port !== undefined) values["config.port"] = String(config.port);
  if (config.transport === "tcp") {
    values["config.http"] = String(config.scheme === "http");
    for (const key of KEPT) {
      const value = config[key];
      if (value !== undefined) values[`config.${key}`] = value;
    }
    return values;
  }
  return { ...values, "config.user": config.user, "config.socket_path": config.socket_path };
}

/** The dialog's seed for an adapter being edited: its sources, and its login as values. */
export function dockerDraftFrom(adapter: Adapter): ConnectionDraft<DockerFormInput> {
  const config = v.parse(dockerConfigSchema, adapter.config);
  const sources = config.sources.map((source) => ({
    name: source.name,
    container: source.container,
    format: source.format,
    regex: source.regex ?? "",
    patterns: source.patterns.join("\n"),
  }));
  return {
    input: { name: adapter.name, transport: config.transport, sources },
    values: valuesOf(config),
  };
}

export type DockerFormPresenter = ConnectionFormPresenter<DockerFormInput, DockerForm>;

const DOCKER_KIND: ConnectionKind<DockerFormInput, DockerForm> = {
  blank: BLANK_DOCKER,
  draftFrom: dockerDraftFrom,
  toBody: toDockerBody,
  toPatch: toDockerPatch,
  formOf: (input) => DOCKER_FORMS[input.transport],
  rules: [{ key: "config.socket_path", schema: dockerSocketSchema }],
};

export function createDockerFormPresenter(
  slug: () => string,
  onSaved: () => void
): DockerFormPresenter {
  return createConnectionFormPresenter(DOCKER_KIND, slug, onSaved);
}
