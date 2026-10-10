import { describe, expect, test } from "bun:test";
import * as v from "valibot";
import type { Adapter, EsFormInput } from "@testate/shared";
import { esFormSchema } from "@testate/shared";

import { esDraftFrom, toEsBody, toEsPatch } from "./logs.elasticsearch.ts";

// #92 (docs/decisions/2026-10-10-elasticsearch.md): the dialog sends an address, a login per auth,
// a CA when one is pasted, and one source per index pattern and query, always read-only.
const SOURCE = {
  name: "shop",
  index: "logs-shop-*",
  query: "log.level:error",
  time_field: "@timestamp",
  message_field: "message",
  patterns: "",
};
const CA = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";
const FORM: EsFormInput = { name: " sit-es ", auth: "api_key", tls_ca: CA, sources: [SOURCE] };
const VALUES = { "config.url": "https://es.sit.internal:9200", "secret.api_key": "encoded==" };
const CONFIG = {
  url: "https://es.sit.internal:9200",
  auth: "basic",
  user: "elastic",
  tls_ca: CA,
  sources: [
    {
      name: "shop",
      index: "logs-shop-*",
      query: "",
      time_field: "ts",
      message_field: "msg",
      patterns: [],
    },
  ],
};

const adapterOf = (config: Adapter["config"]): Adapter => ({
  id: "a-es",
  project_id: "p-shop",
  kind: "logs",
  engine: "elasticsearch",
  tier: "logs",
  name: "sit-es",
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

function refusals(input: EsFormInput): string[] {
  const result = v.safeParse(esFormSchema, input);
  return (result.issues ?? []).map((issue) => `${v.getDotPath(issue)}: ${issue.message}`);
}

describe("the Elasticsearch dialog's body", () => {
  test("is a read-only elasticsearch adapter with its login, CA and searches", () => {
    expect(toEsBody(v.parse(esFormSchema, FORM), VALUES)).toEqual({
      kind: "logs",
      engine: "elasticsearch",
      name: "sit-es",
      mode: "read_only",
      config: {
        url: "https://es.sit.internal:9200",
        auth: "api_key",
        tls_ca: CA,
        sources: [
          {
            name: "shop",
            index: "logs-shop-*",
            query: "log.level:error",
            time_field: "@timestamp",
            message_field: "message",
            patterns: [],
          },
        ],
      },
      secrets: { api_key: "encoded==" },
    });
  });

  test("an edit saves back the config it came with, its CA included", () => {
    const draft = esDraftFrom(adapterOf(CONFIG));
    expect(toEsPatch(v.parse(esFormSchema, draft.input), draft.values)).toEqual({
      name: "sit-es",
      config: CONFIG,
    });
  });
});

describe("the Elasticsearch form's rules", () => {
  test("an index pattern that reaches past a search is refused under its box", () => {
    expect(refusals({ ...FORM, sources: [{ ...SOURCE, index: "_all" }] })).toEqual([
      "sources.0.index: Up to 8 index patterns, comma-separated, of lowercase letters, digits, * . _ + -, not starting with - or _.",
    ]);
  });

  test("a CA that is not PEM is refused", () => {
    expect(refusals({ ...FORM, tls_ca: "MIIB..." })).toEqual([
      "tls_ca: Paste the CA in PEM form, or leave it empty.",
    ]);
  });
});
