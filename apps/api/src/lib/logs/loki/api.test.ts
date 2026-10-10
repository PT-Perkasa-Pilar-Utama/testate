import { afterAll, describe, expect, it } from "bun:test";

import { createLokiApi, urlOf } from "./api.ts";

// #90, L1-L2 (docs/decisions/2026-10-10-loki.md): two GET paths under Loki's base URL, the login
// and tenant as headers, an http URL pinned to netguard's address, and no redirect followed.
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/moved/"))
      return Response.redirect("http://169.254.169.254/latest", 302);
    if (url.pathname.endsWith("/query_range")) return new Response("y".repeat(64 * 1024));
    return Response.json({
      path: url.pathname,
      host: request.headers.get("host"),
      authorization: request.headers.get("authorization"),
      tenant: request.headers.get("x-scope-orgid"),
    });
  },
});
afterAll(() => server.stop(true));
const port = server.port ?? 0;
const LABELS = { kind: "labels", start: 1n, end: 2n } as const;

describe("a Loki call", () => {
  it("is one of two paths under the base URL, its prefix kept", () => {
    expect([
      urlOf("https://logs.example.com/loki-prefix/", LABELS),
      urlOf("https://logs.example.com", {
        kind: "query",
        query: '{service="api"} |= "refund"',
        direction: "backward",
        limit: 200,
        start: 10n,
        end: 20n,
      }),
    ]).toEqual([
      "https://logs.example.com/loki-prefix/loki/api/v1/labels?start=1&end=2",
      "https://logs.example.com/loki/api/v1/query_range?start=10&query=%7Bservice%3D%22api%22%7D+%7C%3D+%22refund%22&direction=backward&limit=200&end=20",
    ]);
  });

  it("sends the login and tenant, and reaches netguard's address with the host's own name", async () => {
    const api = createLokiApi({
      url: `http://loki.sit.internal:${port}/prefix`,
      address: "127.0.0.1",
      port,
      login: { auth: "basic", user: "1234", password: "glc_token" },
      tenant: "shop",
    });
    const answer = await api.get(LABELS, 1024 * 1024);
    expect(JSON.parse(answer.body.toString())).toEqual({
      path: "/prefix/loki/api/v1/labels",
      host: `loki.sit.internal:${port}`,
      authorization: `Basic ${Buffer.from("1234:glc_token").toString("base64")}`,
      tenant: "shop",
    });
  });

  it("refuses a redirect rather than follow it past netguard", async () => {
    const api = createLokiApi({
      url: `http://127.0.0.1:${port}/moved`,
      address: "127.0.0.1",
      port,
      login: { auth: "none" },
    });
    await expect(api.get(LABELS, 1024)).rejects.toMatchObject({ code: "ADAPTER_UNREACHABLE" });
  });

  it("stops a body at its ceiling and says so", async () => {
    const api = createLokiApi({
      url: `http://127.0.0.1:${port}`,
      address: "127.0.0.1",
      port,
      login: { auth: "bearer", token: "t" },
    });
    const answer = await api.get(
      { kind: "query", query: '{a="b"}', direction: "backward", limit: 1, start: 1n },
      1000
    );
    expect([answer.capped, answer.body.length]).toEqual([true, 1000]);
  });
});
