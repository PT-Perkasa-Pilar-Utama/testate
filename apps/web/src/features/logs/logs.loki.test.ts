import { describe, expect, test } from "bun:test";
import * as v from "valibot";
import type { Adapter, LokiFormInput } from "@testate/shared";
import { lokiFormSchema } from "@testate/shared";

import { fieldRefusal } from "./logs.connection.ts";
import { lokiDraftFrom, toLokiBody, toLokiPatch } from "./logs.loki.ts";
import { lokiTenantSchema, lokiUrlSchema } from "@testate/shared";

// #90 (docs/decisions/2026-10-10-loki.md): the Loki dialog sends an address, a login per auth and
// one source per LogQL log query, always read-only; a metric query is refused under its box.
const SOURCE = {
  name: "api",
  query: '{service="api"}',
  format: "json-lines" as const,
  regex: "",
  patterns: "",
};
const FORM: LokiFormInput = { name: " sit-loki ", auth: "basic", sources: [SOURCE] };
const VALUES = {
  "config.url": "https://logs-prod.grafana.net",
  "config.user": "123456",
  "config.tenant": "",
  "secret.password": "glc_token",
};
const CONFIG = {
  url: "https://logs-prod.grafana.net",
  auth: "basic",
  user: "123456",
  tenant: "shop",
  sources: [{ name: "api", query: '{service="api"}', format: "json-lines", patterns: [] }],
};

const adapterOf = (config: Adapter["config"]): Adapter => ({
  id: "a-loki",
  project_id: "p-shop",
  kind: "logs",
  engine: "loki",
  tier: "logs",
  name: "sit-loki",
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

function refusals(input: LokiFormInput): string[] {
  const result = v.safeParse(lokiFormSchema, input);
  return (result.issues ?? []).map((issue) => `${v.getDotPath(issue)}: ${issue.message}`);
}

describe("the Loki dialog's body", () => {
  test("is a read-only loki adapter with its login and queries", () => {
    expect(toLokiBody(v.parse(lokiFormSchema, FORM), VALUES)).toEqual({
      kind: "logs",
      engine: "loki",
      name: "sit-loki",
      mode: "read_only",
      config: {
        url: "https://logs-prod.grafana.net",
        user: "123456",
        auth: "basic",
        sources: [{ name: "api", query: '{service="api"}', format: "json-lines", patterns: [] }],
      },
      secrets: { password: "glc_token" },
    });
  });

  test("an edit saves back the config it came with, and no secret until one is typed", () => {
    const draft = lokiDraftFrom(adapterOf(CONFIG));
    expect(toLokiPatch(v.parse(lokiFormSchema, draft.input), draft.values)).toEqual({
      name: "sit-loki",
      config: CONFIG,
    });
  });
});

describe("the Loki form's rules", () => {
  test("a metric query is refused under the query box", () => {
    expect(
      refusals({ ...FORM, sources: [{ ...SOURCE, query: 'rate({service="api"}[1m])' }] })
    ).toEqual([
      'sources.0.query: A log query starts with a stream selector, like {service="api"}.',
    ]);
  });
});

describe("the Loki login's rules", () => {
  const rules = [
    { key: "config.url", schema: lokiUrlSchema },
    { key: "config.tenant", schema: lokiTenantSchema },
  ];

  test("name a mistyped address or tenant before the API would say only invalid", () => {
    expect([
      fieldRefusal({ "config.url": "logs.example.com" }, rules),
      fieldRefusal(
        { "config.url": "https://logs.example.com", "config.tenant": "shop team" },
        rules
      ),
      fieldRefusal({ "config.url": "https://logs.example.com", "config.tenant": "" }, rules),
    ]).toEqual([
      "Enter Loki's address, like https://logs.example.com, with no login in it.",
      "A tenant holds letters, digits and _ . - only.",
      null,
    ]);
  });
});
