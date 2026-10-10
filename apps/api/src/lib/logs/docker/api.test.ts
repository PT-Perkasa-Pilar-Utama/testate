import { afterAll, describe, expect, it } from "bun:test";
import http from "node:http";
import net from "node:net";
import * as v from "valibot";

import { createDockerApi, pathOf } from "./api.ts";
import { bareChannel } from "../../../../test/docker.ts";

// #88, K2 (docs/decisions/2026-10-10-docker.md): five GET paths built from a request, logs never
// streaming, and a container name that is not one never reaches a path.
describe("a Docker call", () => {
  it("is one of five paths, logs with timestamps and never follow", () => {
    expect([
      pathOf({ kind: "ping" }),
      pathOf({ kind: "version" }),
      pathOf({ kind: "containers" }),
      pathOf({ kind: "inspect", container: "shop-api-1" }),
      pathOf({
        kind: "logs",
        container: "shop_api.1",
        tail: 200,
        since: 1_791_640_000_000_000_042n,
      }),
      pathOf({ kind: "logs", container: "api", tail: "all", until: 1_791_640_000_500_000_000n }),
    ]).toEqual([
      "/_ping",
      "/version",
      "/containers/json?all=1",
      "/containers/shop-api-1/json",
      "/containers/shop_api.1/logs?stdout=1&stderr=1&timestamps=1&follow=0&tail=200&since=1791640000.000000042",
      "/containers/api/logs?stdout=1&stderr=1&timestamps=1&follow=0&tail=all&until=1791640000.500000000",
    ]);
  });

  it.each(["../../images/json", "api/../../exec", "api?follow=1", "-api", "a b", "", "api%2F"])(
    "refuses the container name %p",
    (container) => {
      expect(() => pathOf({ kind: "logs", container, tail: 1 })).toThrow(
        "that is not a container name Testate will send to Docker"
      );
    }
  );
});

const server = http.createServer((request, response) => {
  if (request.url === "/_ping") return void response.end("OK");
  response.end("y".repeat(64 * 1024));
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = v.parse(v.object({ port: v.number() }), server.address()).port;
afterAll(() => server.close());

const api = createDockerApi(
  () =>
    new Promise((resolve, reject) => {
      const socket = net.connect(port, "127.0.0.1", () => resolve(bareChannel(socket)));
      socket.on("error", reject);
    }),
  async () => undefined
);

describe("the Docker client", () => {
  it("speaks HTTP over a bare channel, as an SSH one, and stops a body at its ceiling", async () => {
    const ping = await api.get({ kind: "ping" }, 1024);
    const big = await api.get({ kind: "version" }, 1000);
    expect([
      ping.status,
      ping.body.toString(),
      ping.capped,
      big.capped,
      big.body.length >= 1000,
    ]).toEqual([200, "OK", false, true, true]);
  });
});
