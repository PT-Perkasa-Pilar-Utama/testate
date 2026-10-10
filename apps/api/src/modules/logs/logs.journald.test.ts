import { describe, expect, it } from "bun:test";
import type { Actor, AdapterDraft } from "@testate/shared";

import { TEST_META } from "../../../test/accounts.ts";
import { createAdaptersHarness } from "../../../test/adapters.ts";
import { logsDepsOf } from "../../../test/logs.ts";
import { journalWarnings } from "../adapters/adapters.shell.ts";
import { createLogsService } from "./logs.service.ts";

// #86 (J1, J5, J6 of docs/decisions/2026-10-10-journald.md): a host's journal through the SFTP
// login's host-key trust, masked for a viewer, with the probe naming the fix for a missing group.
const JOURNALD: AdapterDraft = {
  kind: "logs",
  engine: "journald",
  name: "sit-journal",
  config: {
    host: "jrnl.sit.internal",
    user: "deploy",
    sources: [
      { name: "api", units: ["api.service"], patterns: ["card=\\d+"] },
      { name: "all", units: [] },
    ],
  },
  secrets: { password: "deploy-secret" },
};

const LINES = [
  {
    __CURSOR: "s=x;i=1",
    __REALTIME_TIMESTAMP: "1791619200000000",
    MESSAGE: "boot",
    _SYSTEMD_UNIT: "init.scope",
  },
  {
    __CURSOR: "s=x;i=2",
    __REALTIME_TIMESTAMP: "1791619201000000",
    PRIORITY: "3",
    MESSAGE: "refund failed card=4242 token=abc123secret",
    _SYSTEMD_UNIT: "api.service",
  },
];

async function setup() {
  const h = await createAdaptersHarness();
  h.journals.set("jrnl.sit.internal", LINES);
  const { adapter } = await h.adapters.create(h.qa, "shop", JOURNALD, TEST_META);
  const logs = createLogsService(logsDepsOf(h));
  const viewer: Actor = { ...h.qa, role: "viewer" };
  return { h, adapter, logs, viewer };
}

const query = (source: string) => ({ source, limit: 10 });

describe("a journald adapter", () => {
  it("reads its units raw for a tester, and masked with the source's own patterns for a viewer", async () => {
    const { h, adapter, logs, viewer } = await setup();
    const tester = await logs.read(h.qa, "shop", adapter.id, query("api"), null);
    const masked = await logs.read(viewer, "shop", adapter.id, query("api"), null);
    expect([
      tester.page.entries.map((entry) => [entry.message, entry.level, entry.file]),
      masked.page.entries.map((entry) => entry.message),
    ]).toEqual([
      [["refund failed card=4242 token=abc123secret", "error", "api.service"]],
      ["refund failed *** token=***"],
    ]);
  });

  it("trusts the host on a person's first read, refuses an agent a first key, and refuses a changed key", async () => {
    const { h, adapter, logs } = await setup();
    const agent: Actor = { ...h.qa, kind: "token", agent: true };
    const fresh = await setup();
    await expect(
      fresh.logs.read(agent, "shop", fresh.adapter.id, query("all"), null)
    ).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "host_key_untrusted" } });
    await logs.read(h.qa, "shop", adapter.id, query("all"), null);
    h.sftpKey.current = "SHA256:another-host";
    await expect(logs.read(h.qa, "shop", adapter.id, query("all"), null)).rejects.toMatchObject({
      code: "CONFLICT",
      details: { reason: "host_key_changed" },
    });
  });

  it("lists its sources, and answers an unknown one with them", async () => {
    const { h, adapter, logs } = await setup();
    expect(await logs.sources("shop", adapter.id, null)).toEqual(["api", "all"]);
    await expect(logs.read(h.qa, "shop", adapter.id, query("nope"), null)).rejects.toMatchObject({
      code: "NOT_FOUND",
      details: { sources: ["api", "all"] },
    });
  });
});

describe("the journald probe", () => {
  it("names the group a user needs, and a host with no journal", () => {
    const hint = "Hint: You are currently not seeing messages from other users and the system.";
    expect([
      journalWarnings(
        { stdout: '{"MESSAGE":"x"}', stderr: hint, code: 0, capped: false },
        "deploy"
      ),
      journalWarnings(
        { stdout: "", stderr: "No journal files were found.", code: 1, capped: false },
        "deploy"
      ),
      journalWarnings({ stdout: '{"MESSAGE":"x"}', stderr: "", code: 0, capped: false }, "deploy"),
    ]).toEqual([
      [
        {
          code: "journal_access",
          message: "deploy cannot read the whole journal: usermod -aG systemd-journal deploy",
        },
      ],
      [{ code: "no_journal", message: "journalctl found no journal on this host yet" }],
      [],
    ]);
  });
});
