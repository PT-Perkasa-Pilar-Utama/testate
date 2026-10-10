import { describe, expect, it } from "bun:test";

import type { CheckedTarget } from "../../lib/netguard/index.ts";
import { createFileProbe } from "./adapters.files.ts";
import { createScaffoldFileProbe, probeTarget } from "./adapters.probe.ts";
import type { ValidatedConfig } from "./adapters.config.ts";
import type { FileSource } from "../../lib/files/index.ts";
import type { OpenFileSource } from "../../lib/files/open.ts";
import { memoryOpenDocker } from "../../../test/docker.ts";
import { memoryOpenLoki } from "../../../test/loki.ts";
import { memoryOpenShell } from "../../../test/journald.ts";

const validated: ValidatedConfig = {
  kind: "storage",
  tier: "files",
  config: { host: "files.example.test", port: 22, user: "testate", root_path: "/" },
  target: { host: "files.example.test", port: 22 },
  targetHash: "hash",
};

function source(): FileSource {
  return {
    list: async () => ({ data: [], next_cursor: null }),
    stat: async () => ({
      name: "",
      path: "",
      kind: "directory",
      size_bytes: null,
      modified_at: null,
    }),
    read: async () => new Blob([""]).stream(),
    readRange: async () => new Uint8Array(),
    put: async () => undefined,
    remove: async () => undefined,
    move: async () => undefined,
    makeDirectory: async () => undefined,
    removeDirectory: async () => undefined,
    close: async () => undefined,
  };
}

describe("adapter network target pinning", () => {
  it("passes the netguard address into the file probe and file driver", async () => {
    let opened: CheckedTarget | undefined;
    const open: OpenFileSource = (_engine, _config, _secrets, _verify, target) => {
      opened = target;
      return source();
    };
    const fileProbe = createFileProbe(
      open,
      createScaffoldFileProbe(),
      memoryOpenShell(new Map(), { current: "k" }),
      memoryOpenDocker(new Map(), { current: "k" }),
      memoryOpenLoki(new Map())
    );

    await probeTarget(
      {
        netguard: {
          check: async () => ({ allowed: true, addresses: ["192.0.2.44"] }),
        },
        probe: async () => {
          throw new Error("database probe should not run for files");
        },
        fileProbe,
      },
      "sftp",
      validated,
      { password: "secret" }
    );

    expect(opened).toEqual({
      host: "files.example.test",
      port: 22,
      purpose: "files",
      address: "192.0.2.44",
    });
  });
});
