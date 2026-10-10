import { afterAll, describe, expect, it } from "bun:test";

import { createEsApi, indexPath } from "./api.ts";

// #92, E1-E2 (docs/decisions/2026-10-10-elasticsearch.md): `GET /` and `POST /{index}/_search`,
// the index checked and encoded, the API key sent as Kibana shows it.
describe("an index path", () => {
  it("is each pattern encoded, comma-separated", () => {
    expect(indexPath("logs-shop-*, app.2026.10.*")).toBe("logs-shop-*,app.2026.10.*");
  });

  it.each([
    "_all",
    "-logs-*",
    "logs/../_cluster",
    "Logs",
    "a b",
    "logs?x=1",
    "",
    "a,b,c,d,e,f,g,h,i",
  ])("refuses %p", (index) => {
    expect(() => indexPath(index)).toThrow(
      "that is not an index pattern Testate will send to Elasticsearch"
    );
  });
});

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(request) {
    const url = new URL(request.url);
    return Response.json({
      method: request.method,
      path: url.pathname,
      authorization: request.headers.get("authorization"),
      body: request.method === "POST" ? await request.json() : null,
    });
  },
});
afterAll(() => server.stop(true));
const port = server.port ?? 0;

describe("the Elasticsearch client", () => {
  it("posts Testate's body to the index's _search with the API key", async () => {
    const api = createEsApi({
      url: `http://127.0.0.1:${port}/es`,
      address: "127.0.0.1",
      port,
      login: {
        auth: "api_key",
        key: "VnVhQ2ZHY0JDZGJrUW0tZTVhT3g6dWkybHAyYXhUTm1zeWFrdzl0dk5udw==",
      },
    });
    const answer = await api.get(
      { kind: "search", index: "logs-*", body: { size: 1 } },
      1024 * 1024
    );
    expect(JSON.parse(answer.body.toString())).toEqual({
      method: "POST",
      path: "/es/logs-*/_search",
      authorization: "ApiKey VnVhQ2ZHY0JDZGJrUW0tZTVhT3g6dWkybHAyYXhUTm1zeWFrdzl0dk5udw==",
      body: { size: 1 },
    });
  });
});
