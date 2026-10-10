import { describe, expect, it } from "bun:test";
import type { Actor, AdapterDraft, JsonObject } from "@testate/shared";

import { TEST_META } from "../../../test/accounts.ts";
import { createAdaptersHarness } from "../../../test/adapters.ts";
import { fakeEs, memoryOpenEs, stampAt } from "../../../test/elasticsearch.ts";
import type { FakeDoc } from "../../../test/elasticsearch.ts";
import { logsDepsOf } from "../../../test/logs.ts";
import { probeEs } from "../adapters/adapters.elasticsearch.api.ts";
import { validateElasticsearch } from "../adapters/adapters.elasticsearch.ts";
import { fieldOf } from "./logs.elasticsearch.ts";
import { createLogsService } from "./logs.service.ts";

// #92 (E1, E3, E7 of docs/decisions/2026-10-10-elasticsearch.md): documents as entries, their level
// read nested or dotted, masked for a viewer; a probe that names an old cluster and a quiet source.
const SOURCES = [
  { name: "shop", index: "logs-shop-*", patterns: ["card=\\d+"] },
  { name: "typo", index: "logz-*" },
];
const ES: AdapterDraft = {
  kind: "logs",
  engine: "elasticsearch",
  name: "sit-es",
  config: { url: "http://es.sit.internal:9200", sources: SOURCES },
  secrets: {},
};
const NOW = Date.now() - 60_000;
const DOCS: FakeDoc[] = [
  {
    index: "logs-shop-2026.10.10",
    id: "a",
    stamp: stampAt(NOW),
    source: { message: "refund failed card=4242", log: { level: "error" }, order: 42 },
  },
  {
    index: "logs-shop-2026.10.10",
    id: "b",
    stamp: stampAt(NOW + 1000),
    source: { message: "slow query", "log.level": "warn" },
  },
];

async function setup() {
  const h = await createAdaptersHarness();
  h.esHosts.set("es.sit.internal", DOCS);
  const { adapter } = await h.adapters.create(h.qa, "shop", ES, TEST_META);
  const logs = createLogsService(logsDepsOf(h));
  const viewer: Actor = { ...h.qa, role: "viewer" };
  return { h, adapter, logs, viewer };
}

const query = (source: string) => ({ source, limit: 10 });

describe("an elasticsearch adapter", () => {
  it("reads documents newest first, the level nested or dotted, masked for a viewer", async () => {
    const { h, adapter, logs, viewer } = await setup();
    const tester = await logs.read(h.qa, "shop", adapter.id, query("shop"), null);
    const masked = await logs.read(viewer, "shop", adapter.id, query("shop"), null);
    expect([
      tester.page.entries.map((entry) => [entry.message, entry.level, entry.file]),
      tester.page.entries[1]?.fields,
      masked.page.entries.map((entry) => entry.message),
    ]).toEqual([
      [
        ["slow query", "warn", "logs-shop-2026.10.10"],
        ["refund failed card=4242", "error", "logs-shop-2026.10.10"],
      ],
      { log: { level: "error" }, order: 42 },
      ["slow query", "refund failed ***"],
    ]);
  });

  it("lists its sources, and answers an unknown one with them", async () => {
    const { h, adapter, logs } = await setup();
    expect(await logs.sources("shop", adapter.id, null)).toEqual(["shop", "typo"]);
    await expect(logs.read(h.qa, "shop", adapter.id, query("nope"), null)).rejects.toMatchObject({
      code: "NOT_FOUND",
      details: { sources: ["shop", "typo"] },
    });
  });
});

describe("a document's field", () => {
  it("is read dotted or nested, whichever the shipper wrote", () => {
    const doc: JsonObject = {
      "log.level": "warn",
      log: { origin: { file: "api.ts" } },
      message: "x",
    };
    expect([
      fieldOf(doc, "log.level"),
      fieldOf(doc, "log.origin.file"),
      fieldOf(doc, "nope.at.all"),
    ]).toEqual(["warn", "api.ts", undefined]);
  });
});

describe("the elasticsearch probe", () => {
  const hosts = new Map([["es.sit.internal", DOCS]]);

  it("warns of plain http and of a pattern that matched nothing in a day", async () => {
    const probe = await probeEs(memoryOpenEs(hosts), ES.config, {});
    expect(probe.warnings.map((warning) => warning.code)).toEqual(["plaintext", "no_lines"]);
  });

  it("refuses Elasticsearch before 7.10, and takes OpenSearch from 1.0", async () => {
    await expect(probeEs(() => fakeEs(DOCS, { version: "7.9.3" }), ES.config, {})).rejects.toThrow(
      "7.9.3 is older than Elasticsearch 7.10"
    );
    const opensearch = await probeEs(
      () => fakeEs(DOCS, { version: "1.3.0", distribution: "opensearch" }),
      ES.config,
      {}
    );
    expect(opensearch.reachable).toBe(true);
  });
});

describe("an elasticsearch adapter's config", () => {
  const config = (patch: JsonObject): JsonObject => ({ ...ES.config, ...patch });

  it("takes an API key only for api_key auth", () => {
    expect(() => validateElasticsearch(config({ auth: "api_key" }), {})).toThrow(
      "api_key auth needs the secret api_key"
    );
    expect(() => validateElasticsearch(config({ auth: "none" }), { api_key: "k" })).toThrow(
      "secret api_key is not used by elasticsearch with none auth"
    );
    expect(validateElasticsearch(config({ auth: "api_key" }), { api_key: "k" }).target).toEqual({
      host: "es.sit.internal",
      port: 9200,
    });
  });

  it("refuses an index pattern that reaches past a search, saying why", async () => {
    await expect(
      Promise.try(() =>
        validateElasticsearch(config({ sources: [{ name: "all", index: "_all" }] }), {})
      )
    ).rejects.toMatchObject({
      details: {
        issues: [
          "sources.0.index: Up to 8 index patterns, comma-separated, of lowercase letters, digits, * . _ + -, not starting with - or _.",
        ],
      },
    });
  });
});
