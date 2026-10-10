import { describe, expect, it } from "bun:test";
import type { Actor, AdapterDraft } from "@testate/shared";

import { TEST_META } from "../../../test/accounts.ts";
import { createAdaptersHarness } from "../../../test/adapters.ts";
import { FAKE_START, fakeDocker, memoryOpenDocker } from "../../../test/docker.ts";
import type { FakeContainer } from "../../../test/docker.ts";
import { logsDepsOf } from "../../../test/logs.ts";
import { probeDocker } from "../adapters/adapters.docker.api.ts";
import { createLogsService } from "./logs.service.ts";

// #88 (K1, K4, K6 of docs/decisions/2026-10-10-docker.md): a container's log through the SSH
// login's host-key trust, its level from the format and stderr kept as a field, masked for a
// viewer, and each failure a reader can fix named.
const API_SOURCE = { name: "api", container: "shop-api-1", patterns: ["card=\\d+"] };
const SOURCES = [
  API_SOURCE,
  { name: "gone", container: "shop-gone-1" },
  { name: "shipped", container: "shop-syslog-1" },
];
const DOCKER: AdapterDraft = {
  kind: "logs",
  engine: "docker",
  name: "sit-docker",
  config: { transport: "ssh", host: "dock.sit.internal", user: "deploy", sources: SOURCES },
  secrets: { password: "deploy-secret" },
};

const CONTAINERS: FakeContainer[] = [
  {
    name: "shop-api-1",
    lines: [
      { nanos: FAKE_START, stream: "stdout", text: "ERROR: refund failed card=4242" },
      { nanos: FAKE_START + 1_000_000_000n, stream: "stderr", text: "listening on :8080" },
    ],
  },
  { name: "shop-tty-1", tty: true, lines: [] },
  { name: "shop-syslog-1", driver: "syslog", lines: [] },
];

async function setup() {
  const h = await createAdaptersHarness();
  h.dockerHosts.set("dock.sit.internal", CONTAINERS);
  const { adapter } = await h.adapters.create(h.qa, "shop", DOCKER, TEST_META);
  const logs = createLogsService(logsDepsOf(h));
  const viewer: Actor = { ...h.qa, role: "viewer" };
  return { h, adapter, logs, viewer };
}

const query = (source: string) => ({ source, limit: 10 });

describe("a docker adapter", () => {
  it("reads a container newest first, its level from the format and stderr as a field, masked for a viewer", async () => {
    const { h, adapter, logs, viewer } = await setup();
    const tester = await logs.read(h.qa, "shop", adapter.id, query("api"), null);
    const masked = await logs.read(viewer, "shop", adapter.id, query("api"), null);
    expect([
      tester.page.entries.map((entry) => [entry.message, entry.level, entry.file, entry.fields]),
      masked.page.entries.map((entry) => entry.message),
    ]).toEqual([
      [
        ["listening on :8080", "info", "shop-api-1", { stream: "stderr" }],
        ["refund failed card=4242", "error", "shop-api-1", { stream: "stdout" }],
      ],
      ["listening on :8080", "refund failed ***"],
    ]);
  });

  it("trusts the host on a person's first read, refuses an agent a first key, and refuses a changed key", async () => {
    const { h, adapter, logs } = await setup();
    const agent: Actor = { ...h.qa, kind: "token", agent: true };
    const fresh = await setup();
    await expect(
      fresh.logs.read(agent, "shop", fresh.adapter.id, query("api"), null)
    ).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "host_key_untrusted" } });
    await logs.read(h.qa, "shop", adapter.id, query("api"), null);
    h.sftpKey.current = "SHA256:another-host";
    await expect(logs.read(h.qa, "shop", adapter.id, query("api"), null)).rejects.toMatchObject({
      code: "CONFLICT",
      details: { reason: "host_key_changed" },
    });
  });

  it("names a missing container and a driver Docker cannot read back", async () => {
    const { h, adapter, logs } = await setup();
    await expect(logs.read(h.qa, "shop", adapter.id, query("gone"), null)).rejects.toMatchObject({
      code: "NOT_FOUND",
      details: { reason: "container_missing" },
    });
    await expect(logs.read(h.qa, "shop", adapter.id, query("shipped"), null)).rejects.toMatchObject(
      {
        code: "ENGINE_UNSUPPORTED",
        details: { reason: "log_driver" },
      }
    );
  });

  it("lists its sources, and answers an unknown one with them", async () => {
    const { h, adapter, logs } = await setup();
    expect(await logs.sources("shop", adapter.id, null)).toEqual(["api", "gone", "shipped"]);
    await expect(logs.read(h.qa, "shop", adapter.id, query("nope"), null)).rejects.toMatchObject({
      code: "NOT_FOUND",
      details: { sources: ["api", "gone", "shipped"] },
    });
  });
});

describe("the docker probe", () => {
  const hosts = new Map([["dock.sit.internal", CONTAINERS]]);
  const open = memoryOpenDocker(hosts, { current: "SHA256:k" });
  const codes = (warnings: { code: string }[]) => warnings.map((warning) => warning.code);

  it("names a missing container with the ones there are, an unreadable driver, and a TTY", async () => {
    const config = {
      ...DOCKER.config,
      sources: [...SOURCES, { name: "tty", container: "shop-tty-1" }],
    };
    const probe = await probeDocker(open, config, { password: "x" });
    expect([codes(probe.warnings), probe.warnings[0]?.message]).toEqual([
      ["container_missing", "log_driver", "tty"],
      "no container is named shop-gone-1 on this host (it has shop-api-1, shop-tty-1, shop-syslog-1)",
    ]);
  });

  it("warns of plain http, and of a socket the SSH user may not open", async () => {
    const http = {
      transport: "tcp",
      host: "dock.sit.internal",
      scheme: "http",
      sources: [API_SOURCE],
    };
    const refused = { ...DOCKER.config, host: "other.sit.internal", sources: [API_SOURCE] };
    expect([
      codes((await probeDocker(open, http, {})).warnings),
      codes((await probeDocker(open, refused, { password: "x" })).warnings),
    ]).toEqual([["plaintext"], ["docker_access"]]);
  });

  it("refuses a daemon older than API 1.41", async () => {
    await expect(
      probeDocker(() => fakeDocker(CONTAINERS, "1.40"), DOCKER.config, { password: "x" })
    ).rejects.toMatchObject({ code: "ENGINE_UNSUPPORTED", details: { reason: "version" } });
  });
});
