import { describe, expect, test } from "bun:test";
import * as v from "valibot";
import type { Adapter, DockerFormInput } from "@testate/shared";
import { dockerFormSchema } from "@testate/shared";

import { dockerDraftFrom, toDockerBody, toDockerPatch } from "./logs.docker.ts";

// #88 (docs/decisions/2026-10-10-docker.md): the Docker dialog sends an SSH login or a TCP
// address with one source per container, always read-only; an edit keeps a client certificate
// set through the API, and a container name that is not one is refused under its box.
const SOURCE = {
  name: "api",
  container: "shop-api-1",
  format: "plain" as const,
  regex: "",
  patterns: "",
};
const FORM: DockerFormInput = { name: " sit-docker ", transport: "ssh", sources: [SOURCE] };
const SSH_VALUES = {
  "config.host": "dock.sit.internal",
  "config.user": "deploy",
  "secret.password": "deploy-secret",
};
const CERT = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";
const TCP_CONFIG = {
  transport: "tcp",
  host: "proxy.sit.internal",
  port: 2375,
  scheme: "https",
  tls_cert: CERT,
  sources: [{ name: "api", container: "shop-api-1", format: "plain", patterns: [] }],
};

const adapterOf = (config: Adapter["config"]): Adapter => ({
  id: "a-docker",
  project_id: "p-shop",
  kind: "logs",
  engine: "docker",
  tier: "logs",
  name: "sit-docker",
  mode: "read_only",
  status: "ok",
  status_message: null,
  config,
  credential: { set: true },
  readonly_credential: { set: false },
  excluded_tables: [],
  restore_mode: "atomic",
  lock_timeout_ms: 60000,
  engine_version: null,
  dialect: null,
  capabilities: null,
  strategy: null,
  read_only_enforcement: null,
  last_probe_at: null,
  created_by: null,
  created_by_label: null,
  created_at: "2026-10-10T00:00:00.000Z",
  updated_at: "2026-10-10T00:00:00.000Z",
});

function refusals(input: DockerFormInput): string[] {
  const result = v.safeParse(dockerFormSchema, input);
  return (result.issues ?? []).map((issue) => `${v.getDotPath(issue)}: ${issue.message}`);
}

describe("the Docker dialog's body", () => {
  test("is a read-only docker adapter over the SSH login, with its containers", () => {
    expect(toDockerBody(v.parse(dockerFormSchema, FORM), SSH_VALUES)).toEqual({
      kind: "logs",
      engine: "docker",
      name: "sit-docker",
      mode: "read_only",
      config: {
        host: "dock.sit.internal",
        user: "deploy",
        transport: "ssh",
        sources: [{ name: "api", container: "shop-api-1", format: "plain", patterns: [] }],
      },
      secrets: { password: "deploy-secret" },
    });
  });

  test("over TCP the switch is the scheme", () => {
    const form = v.parse(dockerFormSchema, { ...FORM, transport: "tcp" });
    const on = toDockerBody(form, { "config.host": "proxy.sit.internal", "config.http": "true" });
    const off = toDockerBody(form, { "config.host": "proxy.sit.internal", "config.http": "false" });
    expect([on.config, off.config]).toMatchObject([{ scheme: "http" }, { scheme: "https" }]);
  });

  test("an edit saves back the config it came with, a client certificate included", () => {
    const draft = dockerDraftFrom(adapterOf(TCP_CONFIG));
    const saved = toDockerPatch(v.parse(dockerFormSchema, draft.input), draft.values);
    expect(saved).toEqual({ name: "sit-docker", config: TCP_CONFIG });
  });
});

describe("the Docker form's rules", () => {
  test("a container name with a path or a query in it is refused under its box", () => {
    expect(refusals({ ...FORM, sources: [{ ...SOURCE, container: "api/../../exec" }] })).toEqual([
      "sources.0.container: A container name holds letters, digits and _ . - only.",
    ]);
  });

  test("a regex source needs its pattern", () => {
    expect(refusals({ ...FORM, sources: [{ ...SOURCE, format: "regex" }] })).toEqual([
      "sources.0.regex: The regex format needs a pattern.",
    ]);
  });
});
