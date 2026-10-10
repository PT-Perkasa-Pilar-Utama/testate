import { describe, expect, it } from "bun:test";
import type { Actor, AdapterDraft, JsonObject } from "@testate/shared";

import { TEST_META } from "../../../test/accounts.ts";
import { createAdaptersHarness } from "../../../test/adapters.ts";
import { memoryOpenLoki } from "../../../test/loki.ts";
import type { FakeStream } from "../../../test/loki.ts";
import { logsDepsOf } from "../../../test/logs.ts";
import { probeLoki } from "../adapters/adapters.loki.api.ts";
import { validateLoki } from "../adapters/adapters.loki.ts";
import { createLogsService } from "./logs.service.ts";

// #90 (L1, L4, L7 of docs/decisions/2026-10-10-loki.md): a LogQL query's lines on Loki's stamp,
// the level from the format or the labels, labels as fields, masked for a viewer; and a probe that
// names what will not read.
const SOURCES = [
  { name: "api", query: '{service="api"}', format: "json-lines", patterns: ["card=\\d+"] },
  { name: "quiet", query: '{service="nothing"}' },
];
const LOKI: AdapterDraft = {
  kind: "logs",
  engine: "loki",
  name: "sit-loki",
  config: { url: "http://loki.sit.internal:3100", sources: SOURCES },
  secrets: {},
};
const AGO = BigInt(Date.now() - 60_000) * 1_000_000n;
const STREAMS: FakeStream[] = [
  {
    labels: new Map([
      ["service", "api"],
      ["service_name", "api"],
    ]),
    values: [[AGO, '{"level":"error","msg":"refund failed card=4242","order":42}']],
  },
  {
    labels: new Map([
      ["service", "api"],
      ["service_name", "api"],
      ["detected_level", "warn"],
    ]),
    values: [[AGO + 1_000_000_000n, "slow query"]],
  },
];

async function setup() {
  const h = await createAdaptersHarness();
  h.lokiHosts.set("loki.sit.internal", STREAMS);
  const { adapter } = await h.adapters.create(h.qa, "shop", LOKI, TEST_META);
  const logs = createLogsService(logsDepsOf(h));
  const viewer: Actor = { ...h.qa, role: "viewer" };
  return { h, adapter, logs, viewer };
}

const query = (source: string) => ({ source, limit: 10 });

describe("a loki adapter", () => {
  it("reads newest first, its level from the format or the labels, masked for a viewer", async () => {
    const { h, adapter, logs, viewer } = await setup();
    const tester = await logs.read(h.qa, "shop", adapter.id, query("api"), null);
    const masked = await logs.read(viewer, "shop", adapter.id, query("api"), null);
    expect([
      tester.page.entries.map((entry) => [entry.message, entry.level, entry.file]),
      tester.page.entries[1]?.fields,
      masked.page.entries.map((entry) => entry.message),
    ]).toEqual([
      [
        ["slow query", "warn", "api"],
        ["refund failed card=4242", "error", "api"],
      ],
      { service: "api", service_name: "api", order: 42 },
      ["slow query", "refund failed ***"],
    ]);
  });

  it("lists its sources, and answers an unknown one with them", async () => {
    const { h, adapter, logs } = await setup();
    expect(await logs.sources("shop", adapter.id, null)).toEqual(["api", "quiet"]);
    await expect(logs.read(h.qa, "shop", adapter.id, query("nope"), null)).rejects.toMatchObject({
      code: "NOT_FOUND",
      details: { sources: ["api", "quiet"] },
    });
  });
});

describe("the loki probe", () => {
  const hosts = new Map([["loki.sit.internal", STREAMS]]);

  it("warns of plain http and of a source that matched nothing in a day", async () => {
    const probe = await probeLoki(memoryOpenLoki(hosts), LOKI.config, {});
    expect(probe.warnings.map((warning) => warning.code)).toEqual(["plaintext", "no_lines"]);
  });

  it("names a missing tenant", async () => {
    await expect(
      probeLoki(memoryOpenLoki(hosts, { tenant: "shop" }), LOKI.config, {})
    ).rejects.toThrow("Loki runs with tenants: set the adapter's tenant");
  });
});

describe("a loki adapter's config", () => {
  const config = (patch: JsonObject): JsonObject => ({ ...LOKI.config, ...patch });

  it("takes a password only for basic auth, and a token only for bearer", () => {
    expect(() => validateLoki(config({ auth: "basic", user: "1234" }), {})).toThrow(
      "basic auth needs the secret password"
    );
    expect(() => validateLoki(config({ auth: "bearer" }), { password: "x" })).toThrow(
      "secret password is not used by loki with bearer auth"
    );
    expect(validateLoki(config({ auth: "bearer" }), { bearer_token: "t" }).target).toEqual({
      host: "loki.sit.internal",
      port: 3100,
    });
  });

  it("refuses a login in the URL, saying why", async () => {
    await expect(
      Promise.try(() => validateLoki(config({ url: "https://user:pass@logs.example.com" }), {}))
    ).rejects.toMatchObject({
      details: {
        issues: ["url: Enter Loki's address, like https://logs.example.com, with no login in it."],
      },
    });
  });

  it("refuses a metric query, saying why", async () => {
    const sources = [{ name: "rate", query: 'rate({service="api"}[1m])' }];
    await expect(Promise.try(() => validateLoki(config({ sources }), {}))).rejects.toMatchObject({
      details: {
        issues: [
          'sources.0.query: A log query starts with a stream selector, like {service="api"}.',
        ],
      },
    });
  });
});
