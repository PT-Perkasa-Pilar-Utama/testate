import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { hookSchema, restRequestSchema, restRunSchema } from "@testate/shared";

import { expectContract } from "../../../test/contract.ts";
import { TEST_META } from "../../../test/accounts.ts";
import { createAdaptersHarness, httpDraft } from "../../../test/adapters.ts";
import type { AdaptersHarness } from "../../../test/adapters.ts";
import { HOOK_MOCK, REST_REQUEST_MOCK, REST_RUN_MOCK } from "./rest.mock.ts";
import { checkPlaceholders } from "./rest.service.ts";
import type { RestRequestInput } from "./rest.service.ts";

type Seen = { url: string; headers: Record<string, string>; body: string };

const seen: Seen[] = [];
let server: ReturnType<typeof Bun.serve>;
let baseUrl = "";

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const headers: Record<string, string> = {};
      request.headers.forEach((value, key) => {
        headers[key] = value;
      });
      seen.push({ url: url.pathname + url.search, headers, body: await request.text() });
      if (url.pathname === "/redirect")
        return new Response("", { status: 302, headers: { location: "/x" } });
      if (url.pathname === "/slow") await Bun.sleep(3000);
      if (url.pathname === "/big") return new Response("x".repeat(1000));
      if (url.pathname === "/fail") return new Response("nope", { status: 500 });
      return Response.json({ cleared: true });
    },
  });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

const INPUT: RestRequestInput = {
  name: "clear-cache",
  method: "POST",
  path: "/cache/{{project.slug}}/clear",
  query: { state: "{{state.name}}" },
  headers: { "X-Trace": "testate-{{job.id}}" },
  secrets: { "X-Request-Key": "request-secret" },
  body: '{"reason":"checkout {{state.name}}"}',
  expected_status: 200,
};

async function createHarness(): Promise<{ harness: AdaptersHarness; adapterId: string }> {
  const harness = await createAdaptersHarness();
  const { adapter } = await harness.adapters.create(
    harness.qa,
    "shop",
    httpDraft(baseUrl),
    TEST_META
  );
  return { harness, adapterId: adapter.id };
}

describe("rest", () => {
  it("mocks match the contract", () => {
    expectContract(restRequestSchema, REST_REQUEST_MOCK, (clone) => {
      clone["method"] = "FETCH";
    });
    expectContract(restRunSchema, REST_RUN_MOCK, (clone) => {
      clone["duration_ms"] = "fast";
    });
    expectContract(hookSchema, HOOK_MOCK, (clone) => {
      clone["trigger"] = "on_boot";
    });
  });

  it("accepts known placeholders and rejects unknown ones", () => {
    expect(() => checkPlaceholders("/x/{{state.name}}/{{job.id}}")).not.toThrow();
    expect(() => checkPlaceholders("/x/{{user.email}}")).toThrow(
      "unknown placeholder {{user.email}}"
    );
  });

  it("saves a request with sealed secret headers and refuses a duplicate name or a database adapter", async () => {
    const { harness, adapterId } = await createHarness();
    const request = await harness.rest.create("shop", adapterId, INPUT);
    expect(request).toMatchObject({ name: "clear-cache", secret_headers: ["X-Request-Key"] });
    expect(JSON.stringify(request)).not.toContain("request-secret");
    expect(harness.requests.byId(request.id)?.headers_sealed).not.toBeNull();
    await expect(
      harness.rest.create("shop", adapterId, { ...INPUT, name: "Clear-Cache" })
    ).rejects.toThrow("request name is taken");
    await expect(
      harness.rest.create("shop", adapterId, { ...INPUT, name: "bad", path: "/{{user.email}}" })
    ).rejects.toThrow("unknown placeholder");
  });

  it("runs a request with expanded placeholders, adapter and request secrets, and records the run", async () => {
    const { harness, adapterId } = await createHarness();
    const request = await harness.rest.create("shop", adapterId, INPUT);
    const run = await harness.rest.run("shop", adapterId, request.id, {
      placeholders: { state: { id: "s1", name: "baseline" }, job: { id: "j1" } },
    });
    expect(run).toMatchObject({ status_code: 200, matched_expected: true, truncated: false });
    const last = seen.at(-1);
    expect(last?.url).toBe("/cache/shop/clear?state=baseline");
    expect(last?.headers).toMatchObject({
      "x-trace": "testate-j1",
      "x-source": "testate",
      "x-internal-key": "hook-secret",
      "x-request-key": "request-secret",
    });
    expect(last?.body).toBe('{"reason":"checkout baseline"}');
    const runs = await harness.rest.runs("shop", adapterId, request.id, 50);
    expect(runs.map((item) => item.run_id)).toEqual([run.run_id]);
    expect(
      (await harness.rest.runDetail("shop", adapterId, request.id, run.run_id)).response_body
    ).toBe('{"cleared":true}');
  });

  it("returns redirects as results, caps the body, and records a timeout as an unreachable run", async () => {
    const { harness, adapterId } = await createHarness();
    const redirect = await harness.rest.create("shop", adapterId, {
      ...INPUT,
      name: "r",
      path: "/redirect",
      method: "GET",
    });
    expect(
      (await harness.rest.run("shop", adapterId, redirect.id, { placeholders: {} })).status_code
    ).toBe(302);
    const big = await harness.rest.create("shop", adapterId, {
      ...INPUT,
      name: "b",
      path: "/big",
      method: "GET",
    });
    const capped = await harness.rest.run("shop", adapterId, big.id, { placeholders: {} });
    expect(capped.truncated).toBe(true);
    expect(capped.response_body?.length).toBe(64);
    const slow = await harness.rest.create("shop", adapterId, {
      ...INPUT,
      name: "s",
      path: "/slow",
      method: "GET",
    });
    await expect(
      harness.rest.run("shop", adapterId, slow.id, { placeholders: {} })
    ).rejects.toMatchObject({
      code: "ADAPTER_UNREACHABLE",
    });
    const runs = await harness.rest.runs("shop", adapterId, slow.id, 50);
    expect(runs[0]?.error).toBeTruthy();
    expect(runs[0]?.status_code).toBeNull();
  });

  it("blocks a denied host before sending and keeps secrets with the keep marker on update", async () => {
    const { harness, adapterId } = await createHarness();
    const request = await harness.rest.create("shop", adapterId, INPUT);
    harness.blocked.add("127.0.0.1");
    await expect(
      harness.rest.run("shop", adapterId, request.id, { placeholders: {} })
    ).rejects.toMatchObject({
      code: "HOST_BLOCKED",
    });
    harness.blocked.clear();
    const updated = await harness.rest.update("shop", adapterId, request.id, {
      secrets: { "X-Request-Key": "keep", "X-More": "more" },
    });
    expect(updated.secret_headers).toEqual(["X-More", "X-Request-Key"]);
    await harness.rest.run("shop", adapterId, request.id, { placeholders: {} });
    expect(seen.at(-1)?.headers).toMatchObject({
      "x-request-key": "request-secret",
      "x-more": "more",
    });
  });
});
